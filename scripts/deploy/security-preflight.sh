#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
DATABASE=/var/lib/wizard-friends/security.sqlite
ARGS=()
if [[ -f $DATABASE ]]; then
    ARGS+=(--health-url http://127.0.0.1:3002/api/security/health)
elif [[ -f /var/backups/wizard-friends/security-incremental/cursor.json ]]; then
    echo 'Required Wizard audit database missing after initial use; publication blocked. Recover it first.' >&2; exit 1
else
    ARGS+=(--allow-uninitialized)
    echo 'First audit migration: storage check only; new application readiness must pass before reopening.' >&2
fi
if ! python3 "$SCRIPT_DIR/security-ops.py" preflight --database "$DATABASE" --config /etc/wizard-friends/security-ops.json "${ARGS[@]}"; then
    logger -p daemon.err -t game-security 'New Wizard release blocked: required audit/storage readiness failed.' || true
    exit 1
fi
