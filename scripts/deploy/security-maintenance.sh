#!/usr/bin/env bash
set -euo pipefail
if [[ -f /etc/wizard-friends/server.env ]] && grep -Fqx 'SITE_EDITION=cn' /etc/wizard-friends/server.env; then exit 0; fi
[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
exec 9>/run/lock/wizard-friends.security.lock
flock --wait 30 9
DATABASE=/var/lib/wizard-friends/security.sqlite
ARCHIVES=/var/backups/wizard-friends/security-incremental
alarm() { logger -p daemon.err -t game-security 'Wizard security maintenance failed; inspect storage. Retained records were not removed to free space.' || true; }
trap alarm ERR
python3 "$SCRIPT_DIR/security-ops.py" preflight --database "$DATABASE" --config /etc/wizard-friends/security-ops.json
python3 "$SCRIPT_DIR/security-ops.py" backup --database "$DATABASE" --archive-dir "$ARCHIVES"
python3 "$SCRIPT_DIR/security-ops.py" cleanup --database "$DATABASE" --archive-dir "$ARCHIVES"
python3 "$SCRIPT_DIR/security-ops.py" cleanup-network
