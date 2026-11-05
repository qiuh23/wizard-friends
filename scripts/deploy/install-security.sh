#!/usr/bin/env bash
# Explicit reviewed migration. Does not restart games or rewrite live vhosts.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root from the reviewed checkout.' >&2; exit 1; }
SOURCE=$(cd -- "$(dirname -- "$0")" && pwd)
LIB=/usr/local/lib/wizard-friends-deploy
install -d -o root -g root -m 0755 "$LIB" /etc/nginx/conf.d
install -d -o root -g adm -m 0750 /var/log/game-network
if [[ ! -e /var/log/game-network/wizard.log ]]; then install -o www-data -g adm -m 0640 /dev/null /var/log/game-network/wizard.log; fi
for file in security-ops.py security-preflight.sh security-maintenance.sh; do
    install -o root -g root -m 0644 "$SOURCE/$file" "$LIB/$file"
done
for pair in 'game-network-log.conf:/etc/nginx/conf.d/game-network-log.conf' 'game-network.logrotate:/etc/logrotate.d/game-network'; do
    name=${pair%%:*}; target=${pair#*:}
    if [[ -e $target ]] && ! cmp -s "$SOURCE/$name" "$target"; then
        echo "Shared logging policy differs: $target; review before replacing." >&2; exit 1
    fi
    install -o root -g root -m 0644 "$SOURCE/$name" "$target"
done
[[ -e /etc/wizard-friends/security-ops.json ]] || install -o root -g root -m 0644 "$SOURCE/security-ops.json.example" /etc/wizard-friends/security-ops.json
cat > /etc/cron.d/wizard-friends-security <<'CRON'
SHELL=/bin/bash
PATH=/opt/node/bin:/usr/sbin:/usr/bin:/sbin:/bin
13 * * * * root bash /usr/local/lib/wizard-friends-deploy/security-maintenance.sh >/dev/null
*/15 * * * * root bash /usr/local/lib/wizard-friends-deploy/security-preflight.sh >/dev/null
CRON
chmod 0644 /etc/cron.d/wizard-friends-security
cat > /etc/cron.d/game-network-rotation <<'CRON'
SHELL=/bin/bash
PATH=/usr/sbin:/usr/bin:/sbin:/bin
*/15 * * * * root /usr/sbin/logrotate /etc/logrotate.d/game-network >/dev/null || logger -p daemon.err -t game-security 'Safe network log rotation failed; inspect storage and logrotate state.'
CRON
chmod 0644 /etc/cron.d/game-network-rotation
nginx -t
echo 'Wizard security tools/cron and shared safe log format installed; no app or proxy restarted.'
