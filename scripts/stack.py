"""Install and snapshot the Docker stack. Python 3.9+, no third-party packages."""
import argparse
import datetime
import getpass
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent.parent
APPS = ['admin', 'watcher', 'core', 'signer']
COMPOSE = ['docker', 'compose', '-f', str(ROOT / 'docker-compose.yml'), '--profile', 'full']


def dc(*args, **kwargs):
    return subprocess.run(COMPOSE + list(args), cwd=ROOT, check=True, **kwargs)


def capture(*args):
    return dc(*args, stdout=subprocess.PIPE).stdout.decode().strip()


def check_host():
    # Find the process working directory so unrelated Node projects are ignored.
    rows = subprocess.check_output(['ps', '-axo', 'pid=,command='], text=True)
    for row in rows.splitlines():
        if not re.search(r'\b(node|pnpm)\b.*(dist/(main|watcher\.main|index)\.js|dev(:\w+)?)', row):
            continue
        pid = row.strip().split(None, 1)[0]
        result = subprocess.run(['lsof', '-a', '-p', pid, '-d', 'cwd', '-Fn'], capture_output=True, text=True)
        if any(line.startswith('n' + str(ROOT)) for line in result.stdout.splitlines()):
            raise RuntimeError('Stop host Core, signer and watcher before managing the Docker stack (PID ' + pid + ').')


def prepare():
    for name in ['docker', 'lsof']:
        if not shutil.which(name):
            raise RuntimeError(name + ' is required')
    dc('version', stdout=subprocess.DEVNULL)
    check_host()


def permissions():
    (ROOT / 'secrets').mkdir(mode=0o700, exist_ok=True)
    (ROOT / 'backup').mkdir(mode=0o700, exist_ok=True)
    dc('run', '--rm', '--no-deps', '--user', 'root', 'signer',
       'sh', '-ec', 'chown -R signer:signer /secrets; chmod 700 /secrets')
    dc('run', '--rm', '--no-deps', '--user', 'root', 'core',
       'sh', '-ec', 'chown -R core:core /backup')


def install(network='nile'):
    read_crontab()
    env = ROOT / '.env'
    if not env.exists():
        text = (ROOT / '.env.example').read_text()
        rpc_key = os.environ.get('TRONGRID_API_KEY', '').strip()
        if network == 'mainnet' and not rpc_key:
            if not sys.stdin.isatty():
                raise RuntimeError('For a new mainnet installation, run interactively to enter your TronGrid API key, or set TRONGRID_API_KEY.')
            rpc_key = getpass.getpass('Paste your TronGrid API key (input is hidden): ').strip()
            if not rpc_key:
                raise RuntimeError('TronGrid API key is required for mainnet installation.')
        if rpc_key and not re.fullmatch(r'[A-Za-z0-9_-]+', rpc_key):
            raise RuntimeError('Invalid TronGrid API key format.')
        for key in ['SETUP_TOKEN', 'SIGNER_TOKEN', 'SEED_PASSPHRASE']:
            text = re.sub(r'^' + key + r'=.*$', key + '=' + secrets.token_hex(32), text, flags=re.M)
        text = re.sub(r'^NETWORK=.*$', 'NETWORK=' + network, text, flags=re.M)
        rpc = 'https://api.trongrid.io' if network == 'mainnet' else 'https://nile.trongrid.io'
        text = re.sub(r'^TRON_RPC_URLS=.*$', 'TRON_RPC_URLS=' + rpc, text, flags=re.M)
        text = re.sub(r'^TRONGRID_API_KEY=.*$', 'TRONGRID_API_KEY=' + rpc_key, text, flags=re.M)
        text = re.sub(r'^PROVIDER_ORDER=.*$', 'PROVIDER_ORDER=own_pool', text, flags=re.M)
        env.write_text(text)
        env.chmod(0o600)
        print('Created .env for ' + network + '. Setup token is in .env.', flush=True)
    dc('build')
    permissions()
    dc('up', '-d', '--wait', '--wait-timeout', '180')
    schedule()
    print('Ready: http://localhost:8080 or https://usdt.local (OrbStack).')


def cron_text(existing):
    tag = hashlib.sha256(str(ROOT).encode()).hexdigest()[:12]
    begin = '# BEGIN usdt-trx daily backup ' + tag
    end = '# END usdt-trx daily backup ' + tag
    pattern = re.compile(r'^' + re.escape(begin) + r'\n.*?^' + re.escape(end) + r'\n?', re.M | re.S)
    existing = pattern.sub('', existing).rstrip()
    # Absolute Python path and the install-time PATH also work in cron's minimal environment.
    command = 'cd ' + shlex.quote(str(ROOT)) + ' && PATH=' + shlex.quote(os.environ.get('PATH', '/usr/local/bin:/usr/bin:/bin'))
    command += ' ' + shlex.quote(sys.executable) + ' ' + shlex.quote(str(ROOT / 'scripts/stack.py')) + ' backup'
    command += ' >> ' + shlex.quote(str(ROOT / 'backups/daily.log')) + ' 2>&1'
    # Cron treats percent signs specially even inside shell quotes.
    command = command.replace('%', r'\%')
    return (existing + '\n\n' if existing else '') + begin + '\n0 3 * * * ' + command + '\n' + end + '\n'


def read_crontab():
    if not shutil.which('crontab'):
        raise RuntimeError('Install cron (crontab), then rerun scripts/install.sh; the installer enables daily backups automatically.')
    current = subprocess.run(['crontab', '-l'], capture_output=True, text=True)
    if current.returncode and 'no crontab' not in current.stderr.lower():
        raise RuntimeError('Cannot read crontab: ' + current.stderr.strip())
    return current.stdout


def schedule():
    existing = read_crontab()
    folder = ROOT / 'backups'
    folder.mkdir(mode=0o700, exist_ok=True)
    (folder / 'daily.log').touch(mode=0o600, exist_ok=True)
    subprocess.run(['crontab', '-'], input=cron_text(existing), text=True, check=True)
    print('Daily backup scheduled for 03:00 server time; the latest 7 archives are kept.', flush=True)


def prune_backups():
    folder = ROOT / 'backups'
    archives = sorted(p for p in folder.glob('usdt-trx-*.tar.gz')
                      if re.fullmatch(r'usdt-trx-\d{8}-\d{6}-\d{6}\.tar\.gz', p.name))
    for archive in archives[:-7]:
        archive.unlink()
        print('Removed old backup: ' + archive.name, flush=True)


def volume_export(service, mount, target):
    with target.open('wb') as out:
        dc('run', '--rm', '--no-deps', '-T', '--user', 'root', service,
           'tar', 'cf', '-', '-C', mount, '.', stdout=out)


def volume_import(service, mount, source):
    # Fixed mount and service names; archive members are validated beforehand.
    with source.open('rb') as inp:
        dc('run', '--rm', '--no-deps', '-T', '--user', 'root', service,
           'sh', '-ec', 'find ' + mount + ' -mindepth 1 -maxdepth 1 -exec rm -rf {} \\; ; tar xpf - -C ' + mount,
           stdin=inp)


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def backup(destination=None):
    if not (ROOT / '.env').is_file():
        raise RuntimeError('.env is missing')
    target = Path(destination).resolve() if destination else ROOT / 'backups' / ('usdt-trx-' + stamp() + '.tar.gz')
    if target.exists():
        raise RuntimeError('Backup already exists: ' + str(target))
    target.parent.mkdir(parents=True, exist_ok=True)
    running = capture('ps', '--services', '--status', 'running').splitlines()
    running_ids = capture('ps', '-q', '--status', 'running').splitlines()
    if 'postgres' not in running or 'redis' not in running:
        raise RuntimeError('Postgres and Redis must be running before backup.')
    for name in ['secrets', 'backup']:
        if any(p.is_symlink() for p in [ROOT / name, *(ROOT / name).rglob('*')]):
            raise RuntimeError('Backup directories must contain regular files, not symlinks.')
    partial = target.with_name(target.name + '.partial')
    if partial.exists():
        raise RuntimeError('Incomplete backup exists: ' + str(partial))
    try:
        dc('stop', *APPS)
        dc('exec', '-T', 'redis', 'redis-cli', 'SAVE', stdout=subprocess.DEVNULL)
        dc('stop', 'redis')
        with tempfile.TemporaryDirectory(prefix='usdt-backup-') as tmp:
            folder = Path(tmp)
            shutil.copy2(ROOT / '.env', folder / '.env')
            for name in ['secrets', 'backup']:
                if (ROOT / name).exists():
                    shutil.copytree(ROOT / name, folder / name)
            if (ROOT / 'signer-audit.log').exists():
                shutil.copy2(ROOT / 'signer-audit.log', folder / 'signer-audit.log')
            with (folder / 'postgres.dump').open('wb') as out:
                dc('exec', '-T', 'postgres', 'pg_dump', '-U', 'usdt', '-d', 'usdt_trx', '-Fc', stdout=out)
            volume_export('redis', '/data', folder / 'redis.tar')
            volume_export('signer', '/audit', folder / 'audit.tar')
            manifest = {'version': 1, 'createdAt': stamp(), 'commit': subprocess.run(
                ['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True).stdout.strip(), 'sha256': {}}
            for path in sorted(folder.rglob('*')):
                if path.is_file():
                    manifest['sha256'][path.relative_to(folder).as_posix()] = digest(path)
            (folder / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
            with tarfile.open(partial, 'w:gz') as archive:
                for path in sorted(folder.iterdir()):
                    archive.add(path, arcname=path.name)
            partial.replace(target)
        print('Backup: ' + str(target), flush=True)
        print('Contains .env and wallet keys. Store the archive privately off-server.', flush=True)
    finally:
        partial.unlink(missing_ok=True)
        # Restart precisely the services that were running, including manual-mode stacks.
        if running_ids:
            subprocess.run(['docker', 'start', *running_ids], check=True, stdout=subprocess.DEVNULL)
    if destination is None:
        prune_backups()
    return target


def unpack_safe(source, destination):
    with tarfile.open(source) as archive:
        seen = set()
        for member in archive.getmembers():
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
                raise RuntimeError('Unsafe archive member: ' + member.name)
            if str(path) in seen:
                raise RuntimeError('Duplicate archive member: ' + member.name)
            seen.add(str(path))
        archive.extractall(destination)


def validate(folder):
    manifest = json.loads((folder / 'manifest.json').read_text())
    if not isinstance(manifest, dict) or manifest.get('version') != 1:
        raise RuntimeError('Unsupported backup version')
    hashes = manifest.get('sha256')
    if not isinstance(hashes, dict) or any(
        not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value)
        for value in hashes.values()
    ):
        raise RuntimeError('Invalid backup checksums')
    if not {'.env', 'postgres.dump', 'redis.tar', 'audit.tar'}.issubset(hashes):
        raise RuntimeError('Incomplete backup')
    files = {p.relative_to(folder).as_posix() for p in folder.rglob('*') if p.is_file()}
    if files != set(hashes) | {'manifest.json'}:
        raise RuntimeError('Backup file list does not match manifest')
    for name, expected in hashes.items():
        if digest(folder / name) != expected:
            raise RuntimeError('Checksum mismatch: ' + name)
    # Validate nested volume archives before changing any live state.
    for name in ['redis.tar', 'audit.tar']:
        with tempfile.TemporaryDirectory(prefix='usdt-check-') as tmp:
            unpack_safe(folder / name, Path(tmp))


def restore(source):
    source = Path(source).resolve()
    with tempfile.TemporaryDirectory(prefix='usdt-restore-') as tmp:
        folder = Path(tmp)
        unpack_safe(source, folder)
        validate(folder)
        read_crontab()
        print('This replaces the database, queues, admin account, config and wallet with the archive contents.')
        if input('Type RESTORE to continue: ') != 'RESTORE':
            raise RuntimeError('Cancelled; nothing changed')
        # Keep a complete rollback snapshot before touching an existing installation.
        if (ROOT / '.env').exists():
            dc('up', '-d', '--wait', 'postgres', 'redis')
            rollback = backup()
            print('Rollback archive: ' + str(rollback), flush=True)
            dc('stop', *APPS, 'redis')
        shutil.copy2(folder / '.env', ROOT / '.env')
        (ROOT / '.env').chmod(0o600)
        dc('build')
        for name in ['secrets', 'backup']:
            if (ROOT / name).exists():
                shutil.rmtree(ROOT / name)
            if (folder / name).exists():
                shutil.copytree(folder / name, ROOT / name)
        if (folder / 'signer-audit.log').exists():
            shutil.copy2(folder / 'signer-audit.log', ROOT / 'signer-audit.log')
        permissions()
        dc('up', '-d', '--wait', 'postgres')
        with (folder / 'postgres.dump').open('rb') as inp:
            dc('exec', '-T', 'postgres', 'pg_restore', '-U', 'usdt', '-d', 'postgres',
               '--clean', '--if-exists', '--create', '--no-owner', '--exit-on-error', stdin=inp)
        volume_import('redis', '/data', folder / 'redis.tar')
        volume_import('signer', '/audit', folder / 'audit.tar')
        dc('up', '-d', '--wait', '--wait-timeout', '180')
        schedule()
        print('Restored. Use the admin password and authenticator from the backup.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('install', help='Create .env if absent; build and start the full stack').add_argument(
        '--network', choices=['mainnet', 'nile'], default='nile', help='Network for a new .env (default: nile); existing .env is preserved')
    backup_parser = commands.add_parser('backup', help='Briefly stop writers; create one private archive; keep the latest 7')
    backup_parser.add_argument('destination', nargs='?')
    backup_parser.add_argument('--schedule', action='store_true', help='Install daily cron backup at 03:00 without taking a backup now')
    commands.add_parser('restore', help='Validate archive; save rollback backup; restore and start').add_argument('archive')
    args = parser.parse_args()
    os.umask(0o077)
    prepare()
    # A cron job must not overlap a manual backup, restore or installation.
    with (ROOT / '.stack.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another installation, backup or restore is already running.')
        if args.command == 'install':
            install(args.network)
        elif args.command == 'backup':
            schedule() if args.schedule else backup(args.destination)
        else:
            restore(args.archive)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, tarfile.TarError, subprocess.CalledProcessError, EOFError) as error:
        print('Error: ' + str(error), file=sys.stderr)
        sys.exit(1)
