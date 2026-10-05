"""Run: python3 -m unittest discover -s scripts -p 'test_stack.py'.

Add STACK_INTEGRATION=1 to test Docker installation, backup and restore in an
isolated project with temporary directories, test keys and no published ports.
"""
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import stack


class ArchiveTests(unittest.TestCase):
    def test_missing_cron_stops_install_and_restore_before_live_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with patch.object(stack, 'ROOT', root), patch.object(stack.shutil, 'which', return_value=None), \
                 patch.object(stack, 'dc') as docker, patch.object(stack, 'unpack_safe'), \
                 patch.object(stack, 'validate'), patch('builtins.input') as confirm:
                with self.assertRaisesRegex(RuntimeError, 'Install cron'):
                    stack.install('mainnet')
                with self.assertRaisesRegex(RuntimeError, 'Install cron'):
                    stack.restore(root / 'archive.tar.gz')
                self.assertFalse((root / '.env').exists())
                docker.assert_not_called()
                confirm.assert_not_called()

    def test_mainnet_install_saves_key_and_preserves_existing_config(self):
        example = (stack.ROOT / '.env.example').read_text()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / '.env.example').write_text(example)
            with patch.object(stack, 'ROOT', root), patch.object(stack, 'dc'), patch.object(stack, 'permissions'), patch.object(stack, 'schedule') as schedule, \
                 patch.object(stack, 'read_crontab', return_value=''), patch.dict(os.environ, {'TRONGRID_API_KEY': 'example-api-key'}):
                stack.install('mainnet')
                schedule.assert_called_once_with()
                text = (root / '.env').read_text()
                self.assertIn('NETWORK=mainnet\n', text)
                self.assertIn('TRON_RPC_URLS=https://api.trongrid.io\n', text)
                self.assertIn('TRONGRID_API_KEY=example-api-key\n', text)
                self.assertNotIn('SIGNER_TOKEN=change-me', text)
                self.assertNotIn('SEED_PASSPHRASE= ', text)
                stack.install('nile')
                self.assertEqual(schedule.call_count, 2)
                self.assertEqual((root / '.env').read_text(), text)

    def test_cron_update_preserves_other_jobs_and_is_idempotent(self):
        original = '0 5 * * * /usr/local/bin/other-backup\n'
        updated = stack.cron_text(original)
        self.assertIn(original, updated)
        self.assertIn('0 3 * * * ', updated)
        self.assertEqual(updated, stack.cron_text(updated))
        self.assertEqual(updated.count('# BEGIN usdt-trx'), 1)

    def test_retention_keeps_seven_complete_archives_and_ignores_other_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / 'backups'
            folder.mkdir()
            names = ['usdt-trx-20261001-030000-%06d.tar.gz' % n for n in range(10)]
            for name in names + ['manual.tar.gz', 'usdt-trx-20261002-030000-000000.tar.gz.partial']:
                (folder / name).touch()
            with patch.object(stack, 'ROOT', root):
                stack.prune_backups()
            self.assertEqual(sorted(p.name for p in folder.glob('usdt-trx-*.tar.gz')), names[-7:])
            self.assertTrue((folder / 'manual.tar.gz').exists())
            self.assertTrue((folder / 'usdt-trx-20261002-030000-000000.tar.gz.partial').exists())

    def test_path_traversal_and_links_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name, kind in [('../escape', tarfile.REGTYPE), ('/escape', tarfile.REGTYPE),
                               ('link', tarfile.SYMTYPE), ('device', tarfile.CHRTYPE)]:
                archive = Path(tmp) / 'bad.tar'
                with tarfile.open(archive, 'w') as out:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    member.linkname = '../escape'
                    out.addfile(member)
                with self.assertRaises(RuntimeError):
                    stack.unpack_safe(archive, Path(tmp) / 'out')

    def test_corrupt_backup_is_rejected_before_confirmation(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            for name in ['.env', 'postgres.dump']:
                (folder / name).write_text('test')
            for name in ['redis.tar', 'audit.tar']:
                with tarfile.open(folder / name, 'w'):
                    pass
            hashes = {p.name: stack.digest(p) for p in folder.iterdir()}
            (folder / 'manifest.json').write_text(json.dumps({'version': 1, 'sha256': hashes}))
            stack.validate(folder)
            (folder / 'postgres.dump').write_text('corrupt')
            archive = folder / 'backup.tar.gz'
            with tarfile.open(archive, 'w:gz') as out:
                for name in [*hashes, 'manifest.json']:
                    out.add(folder / name, arcname=name)
            with patch('builtins.input') as confirmation, patch.object(stack, 'dc') as docker:
                with self.assertRaisesRegex(RuntimeError, 'Checksum mismatch'):
                    stack.restore(archive)
                confirmation.assert_not_called()
                docker.assert_not_called()


@unittest.skipUnless(os.environ.get('STACK_INTEGRATION') == '1', 'Set STACK_INTEGRATION=1 for Docker test')
class DockerRoundTrip(unittest.TestCase):
    def test_install_backup_restore(self):
        repo = stack.ROOT
        config = json.loads(stack.capture('config', '--format', 'json'))
        with tempfile.TemporaryDirectory(prefix='usdt-stack-test-') as tmp:
            root = Path(tmp)
            example = (repo / '.env.example').read_text()
            (root / '.env.example').write_text(example)
            env = {}
            for line in example.splitlines():
                line = line.split('#', 1)[0].strip()
                if '=' in line:
                    key, value = line.split('=', 1)
                    env[key] = value.strip()
            env.update(NETWORK='nile', RUN_WORKERS='false', SIGNER_TOKEN='test-token-' * 4,
                       SEED_PASSPHRASE='test-passphrase', SETUP_TOKEN='test-setup-token',
                       DATABASE_URL='postgresql://usdt:usdt@postgres:5432/usdt_trx',
                       REDIS_URL='redis://redis:6379', SIGNER_URL='http://signer:3100',
                       HOST='0.0.0.0', PORT='3000', SIGNER_HOST='0.0.0.0',
                       SEED_FILE='/secrets/seed.enc.json', POOL_KEY_FILE='/secrets/pool.enc.json',
                       AUDIT_LOG_PATH='/audit/signer-audit.log', LABELS_FILE='/backup/labels.json',
                       PROVIDER_ORDER='own_pool')
            # Use the built images, isolated volumes and bind mounts. No production
            # secrets, external scanning, or publicly accessible ports enter this test.
            image_prefix = config.pop('name')
            config['networks'] = {'default': {}, 'signer-net': {'internal': True}}
            config['volumes'] = {'pgdata': {}, 'redisdata': {}, 'signeraudit': {}}
            for name, service in config['services'].items():
                if 'build' in service:
                    service['image'] = service.get('image') or image_prefix + '-' + name
                service.pop('build', None)
                service.pop('ports', None)
                service.pop('labels', None)
                service['restart'] = 'no'
                if name not in ['postgres', 'redis', 'admin']:
                    service['environment'] = dict(env)
                for mount in service.get('volumes', []):
                    if mount['type'] == 'bind':
                        mount['source'] = str(root / ('secrets' if mount['target'] == '/secrets' else 'backup'))
            config['services']['watcher']['command'] = ['sh', '-c', 'sleep 3600']
            compose = root / 'compose.json'
            compose.write_text(json.dumps(config))
            command = ['docker', 'compose', '-p', 'usdt-trx-stack-test-' + str(os.getpid()),
                       '-f', str(compose), '--profile', 'full']
            with patch.object(stack, 'ROOT', root), patch.object(stack, 'COMPOSE', command), patch.object(stack, 'schedule'), patch.object(stack, 'read_crontab', return_value=''):
                try:
                    stack.install()
                    stack.dc('exec', '-T', 'postgres', 'psql', '-U', 'usdt', '-d', 'usdt_trx',
                             '-c', "CREATE TABLE ops_probe (value text); INSERT INTO ops_probe VALUES ('original');")
                    stack.dc('exec', '-T', 'redis', 'redis-cli', 'SET', 'ops-probe', 'original')
                    code = "fetch('http://signer:3100/v1/wallet/create',{method:'POST',headers:{authorization:'Bearer '+process.env.SIGNER_TOKEN,'content-type':'application/json'},body:'{\"words\":12}'}).then(r=>{if(!r.ok) process.exit(1)})"
                    stack.dc('exec', '-T', 'core', 'node', '-e', code)
                    seed_hash = stack.digest(root / 'secrets/seed.enc.json')
                    env_hash = stack.digest(root / '.env')
                    (root / 'backup/labels.json').write_text('{"test":"original"}')
                    archive = stack.backup()
                    stack.dc('exec', '-T', 'postgres', 'psql', '-U', 'usdt', '-d', 'usdt_trx',
                             '-c', "UPDATE ops_probe SET value='changed';")
                    stack.dc('exec', '-T', 'redis', 'redis-cli', 'SET', 'ops-probe', 'changed')
                    (root / 'backup/labels.json').write_text('changed')
                    with patch('builtins.input', return_value='RESTORE'):
                        stack.restore(archive)
                    self.assertEqual(stack.capture('exec', '-T', 'postgres', 'psql', '-U', 'usdt',
                                                  '-d', 'usdt_trx', '-Atc', 'SELECT value FROM ops_probe'), 'original')
                    self.assertEqual(stack.capture('exec', '-T', 'redis', 'redis-cli', 'GET', 'ops-probe'), 'original')
                    self.assertEqual(stack.digest(root / 'secrets/seed.enc.json'), seed_hash)
                    self.assertEqual(stack.digest(root / '.env'), env_hash)
                    self.assertEqual((root / 'backup/labels.json').read_text(), '{"test":"original"}')
                    self.assertEqual(len(list((root / 'backups').glob('*.tar.gz'))), 2)
                finally:
                    stack.dc('down', '-v', '--remove-orphans')


if __name__ == '__main__':
    unittest.main()
