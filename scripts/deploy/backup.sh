#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]]
DB=/var/lib/wizard-friends/rooms.sqlite
DEST=/var/backups/wizard-friends
install -d -o root -g root -m 0700 "$DEST"
PREFIX="$DEST/rooms-$(date -u +%Y%m%dT%H%M%S)-$$"
umask 077
CONFIG=()
for path in etc/wizard-friends/server.env etc/systemd/system/wizard-friends.service etc/nginx/sites-available/wizard-friends etc/nginx/sites-enabled/wizard-friends etc/sudoers.d/wizard-friends-deploy etc/cron.daily/wizard-friends-backup opt/wizard-friends/current opt/wizard-friends/previous; do
  [[ ! -e /$path && ! -L /$path ]] || CONFIG+=("$path")
done
if [[ ${#CONFIG[@]} -gt 0 ]]; then
  # Store only fixed Wizard configuration and symlink pointers; never follow
  # current/previous into app data or include another game's files.
  tar -czf "$PREFIX.config.tar.gz" -C / "${CONFIG[@]}"
  echo "Wizard configuration and release pointers backed up: $PREFIX.config.tar.gz"
fi
if [[ -f $DB ]]; then
  sqlite3 "$DB" ".timeout 15000" ".backup '$PREFIX.sqlite'"
  [[ $(sqlite3 "$PREFIX.sqlite" 'PRAGMA integrity_check;') == ok ]]
  echo "Wizard online SQLite backup verified: $PREFIX.sqlite"
else
  echo 'No Wizard database yet; configuration snapshot completed.'
fi
find "$DEST" -maxdepth 1 -type f -name 'rooms-*.sqlite' -mtime +14 -delete
find "$DEST" -maxdepth 1 -type f -name 'rooms-*.config.tar.gz' -mtime +14 -delete
