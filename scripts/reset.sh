#!/usr/bin/env bash
# Full reset of the local Docker stack: stops everything, DROPS the database and queues, and moves the wallet seed
# and labels out of the way (into a timestamped backup folder — nothing is deleted). After it you go through the
# first-run setup page again.
#
#   scripts/reset.sh            # reset and leave the stack stopped
#   scripts/reset.sh --start    # reset, then build and start the stack again
#
# Two typed confirmations are required on purpose: this is the one command that makes the wallet disappear from
# this machine. The seed file survives in backup-<timestamp>/secrets, but only if you keep that folder.
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT="$(basename "$PWD")"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="backup-${STAMP}"
START=0
for arg in "$@"; do
  case "$arg" in
    --start) START=1 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg"; exit 2 ;;
  esac
done

if ! command -v docker >/dev/null; then echo "docker not found"; exit 1; fi
# Host-side dev processes (pnpm dev:core / dev:signer / dev:watcher) share the Docker Postgres/Redis and would keep
# writing into the fresh database with a stale in-memory wallet. Refuse until they are gone.
STRAY="$(ps -axo pid=,command= | grep -E 'dist/(main|watcher\.main|index)\.js' | grep -v grep || true)"
if [ -n "$STRAY" ]; then
  echo "Stop these host processes first (they use the same database as Docker):"
  echo "$STRAY"
  exit 1
fi
if [ ! -f docker-compose.yml ]; then echo "run this from the project folder (docker-compose.yml not found)"; exit 1; fi

NETWORK="$(grep -E '^NETWORK=' .env 2>/dev/null | cut -d= -f2- || true)"
HAS_SEED=0; [ -f secrets/seed.enc.json ] && HAS_SEED=1
RUNNING="$(docker compose --profile full ps --format '{{.Name}}' 2>/dev/null | tr '\n' ' ')"

cat <<MSG

==============================================================================
  RESET "${PROJECT}"  (network: ${NETWORK:-unknown})
==============================================================================
This will:
  1. stop all containers${RUNNING:+ (running now: ${RUNNING})}
  2. DELETE the Postgres and Redis volumes:
       - every deposit address and who it was given to
       - deposit / sweep / payout history and the audit log
       - the admin account (password + authenticator enrolment)
       - runtime settings changed in the UI
  3. MOVE (not delete) into ./${DEST}/ :
       - secrets/            $( [ $HAS_SEED = 1 ] && echo "<- contains your WALLET SEED (seed.enc.json)" || echo "(no seed file present)" )
       - backup/             (labels backup, if any)
       - signer-audit.log    (if any)

What you lose for good unless you have the seed phrase written down or keep ./${DEST}/:
  ACCESS TO EVERY ADDRESS OF THIS WALLET AND THE FUNDS ON THEM.
  Balances live on the blockchain; the seed is the only key to them.

.env is not touched (SETUP_TOKEN, passphrases, network stay as they are).
==============================================================================
MSG

read -r -p 'Type exactly  I UNDERSTAND  to continue: ' ANSWER1
if [ "$ANSWER1" != "I UNDERSTAND" ]; then echo "aborted, nothing changed"; exit 1; fi

echo
if [ $HAS_SEED = 1 ]; then
  echo "Last check. The seed file secrets/seed.enc.json will be moved to ./${DEST}/secrets/."
  echo "If you do not have the seed phrase on paper AND you lose that folder, the wallet is gone."
else
  echo "Last check. No seed file is present; the database will be wiped."
fi
read -r -p "Type exactly  DELETE ${PROJECT} DATA  to proceed: " ANSWER2
if [ "$ANSWER2" != "DELETE ${PROJECT} DATA" ]; then echo "aborted, nothing changed"; exit 1; fi

echo
echo "-> stopping the stack and dropping volumes"
docker compose --profile full down -v --remove-orphans

echo "-> moving secrets, labels and the signer audit log to ./${DEST}/"
mkdir -p "${DEST}"
[ -d secrets ] && mv secrets "${DEST}/secrets"
[ -d backup ] && mv backup "${DEST}/backup"
[ -f signer-audit.log ] && mv signer-audit.log "${DEST}/"
mkdir -p backup && mkdir -m 700 -p secrets

echo
echo "Done. Old data is in ./${DEST}/ (delete it yourself once you are sure)."
if [ $START = 1 ]; then
  echo "-> building and starting the stack"
  docker compose --profile full up -d --build
  echo
  echo "Open the admin UI (https://usdt.local) and go through the setup page with SETUP_TOKEN from .env."
else
  echo "Start again with:  docker compose --profile full up -d --build"
fi
