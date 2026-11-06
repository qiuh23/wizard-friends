#!/usr/bin/env bash
# Domestic migration only: stop new access/communication audit collection, retain old data.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root from the reviewed checkout.' >&2; exit 1; }
rm -f -- /etc/cron.d/wizard-friends-security
for unit in wizard-friends-security.timer wizard-friends-security-maintenance.timer wizard-friends-security-preflight.timer; do
  if systemctl cat "$unit" >/dev/null 2>&1; then systemctl disable --now "$unit"; fi
done
# Shared network-log rotation is owned by the shared deployment; do not touch other games.
# Existing security.sqlite, archives and network log files remain untouched.
echo 'Domestic Wizard audit jobs disabled; existing archives and game backups preserved.'
