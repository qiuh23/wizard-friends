#!/usr/bin/env bash
# Reviewed one-time host preparation. Never edits the athlete installation.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root from the reviewed Wizard checkout.' >&2; exit 1; }
SOURCE=$(cd -- "$(dirname -- "$0")" && pwd)
# Rerunning preparation must not reset an already migrated HTTPS origin.
if [[ -f /etc/wizard-friends/server.env ]]; then
  EXISTING_ORIGIN=$(sed -n 's/^PUBLIC_ORIGIN=//p' /etc/wizard-friends/server.env)
  PUBLIC_ORIGIN=${PUBLIC_ORIGIN:-$EXISTING_ORIGIN}
else
  PUBLIC_ORIGIN=${PUBLIC_ORIGIN:-http://115.29.188.62:8081}
fi
PORT=${PORT:-3002}
LEGACY_PUBLIC_ORIGIN=${LEGACY_PUBLIC_ORIGIN:-}
export PUBLIC_ORIGIN PORT LEGACY_PUBLIC_ORIGIN
PUBLIC_PORT=$(PUBLIC_PORT=${PUBLIC_PORT:-} /opt/node/bin/node "$SOURCE/site-config.mjs" port)
export PUBLIC_PORT
/opt/node/bin/node -e 'if(Number(process.versions.node.split(".")[0])!==24)throw Error("Require existing Node 24");'
if [[ $PUBLIC_ORIGIN == https://* ]]; then
  TLS_HOST=${PUBLIC_ORIGIN#https://}
  [[ -s /etc/letsencrypt/live/$TLS_HOST/fullchain.pem && -s /etc/letsencrypt/live/$TLS_HOST/privkey.pem ]] || { echo 'Prepare and verify the exact-host certificate before installing the TLS site; see docs/https-domain-transition.md.' >&2; exit 1; }
  if [[ -z $LEGACY_PUBLIC_ORIGIN && -f /etc/nginx/sites-available/wizard-friends ]] && grep -Eq 'listen[[:space:]]+8081;' /etc/nginx/sites-available/wizard-friends; then
    echo 'Existing legacy 8081 listener must be explicitly retained with LEGACY_PUBLIC_ORIGIN during transition.' >&2; exit 1
  fi
fi
for command in nginx sqlite3 python3 flock visudo curl ss; do command -v "$command" >/dev/null || { echo "Missing existing host prerequisite: $command" >&2; exit 1; }; done
exec 9>/run/lock/wizard-friends.deploy.lock
flock --wait 900 9
if [[ ! -f /etc/wizard-friends/server.env ]]; then
  [[ -z $(ss -H -ltn "sport = :$PORT") ]] || { echo "Port $PORT is occupied; choose another internal port before installation." >&2; exit 1; }
  # 443 is shared by the existing Nginx; ownership is by exact server_name.
  if [[ $PUBLIC_ORIGIN == http://* ]]; then
    [[ -z $(ss -H -ltn "sport = :$PUBLIC_PORT") ]] || { echo "Port $PUBLIC_PORT is occupied; review before installation." >&2; exit 1; }
  fi
fi
for account in wizard wizard-deploy; do id "$account" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$account"; done
install -d -o root -g wizard -m 0750 /opt/wizard-friends /opt/wizard-friends/releases /etc/wizard-friends
install -d -o wizard -g wizard -m 0750 /var/lib/wizard-friends /var/log/wizard-friends
install -d -o root -g root -m 0700 /var/backups/wizard-friends /var/lib/wizard-friends-deploy-state
# Preserve only this game's previous host configuration before replacing its
# fixed installer, service or site. Existing immutable app releases are retained.
bash "$SOURCE/backup.sh"
install -d -o root -g root -m 0755 /usr/local/lib/wizard-friends-deploy
for file in install.mjs unpack.py backup.sh probe.mjs site-config.mjs security-ops.py security-preflight.sh security-maintenance.sh; do install -o root -g root -m 0644 "$SOURCE/$file" "/usr/local/lib/wizard-friends-deploy/$file"; done
bash "$SOURCE/install-security.sh"
install -o root -g root -m 0755 "$SOURCE/ci-install.sh" /usr/local/sbin/wizard-friends-ci-install
if [[ ! -f /etc/wizard-friends/server.env ]]; then
  cat > /etc/wizard-friends/server.env <<EOF
NODE_ENV=production
SITE_EDITION=cn
HOST=127.0.0.1
TRUST_PROXY=1
PORT=$PORT
DATABASE_PATH=/var/lib/wizard-friends/rooms.sqlite
STATIC_DIR=/opt/wizard-friends/current/dist
PUBLIC_ORIGIN=$PUBLIC_ORIGIN
ALLOWED_ORIGINS=$LEGACY_PUBLIC_ORIGIN

EOF
  chown root:wizard /etc/wizard-friends/server.env
  chmod 0640 /etc/wizard-friends/server.env
else
  if grep -q '^SITE_EDITION=' /etc/wizard-friends/server.env; then grep -Fqx 'SITE_EDITION=cn' /etc/wizard-friends/server.env || { echo 'SITE_EDITION must be cn' >&2; exit 1; }; else printf '\nSITE_EDITION=cn\n' >> /etc/wizard-friends/server.env; fi
  sed -i '/^BACKENDS_CONFIG_JSON=/d' /etc/wizard-friends/server.env
  for value in "HOST=127.0.0.1" "PORT=$PORT" "PUBLIC_ORIGIN=$PUBLIC_ORIGIN" 'DATABASE_PATH=/var/lib/wizard-friends/rooms.sqlite'; do grep -Fqx "$value" /etc/wizard-friends/server.env || { echo 'Existing Wizard config differs; preserve it and review requested ports/origin.' >&2; exit 1; }; done
fi
cat > /etc/systemd/system/wizard-friends.service <<'SERVICE'
[Unit]
Description=Wizard Friends independent authoritative Node service
After=network.target
[Service]
Type=simple
User=wizard
Group=wizard
WorkingDirectory=/opt/wizard-friends/current
EnvironmentFile=/etc/wizard-friends/server.env
ExecStart=/opt/node/bin/node server/index.js
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/wizard-friends /var/log/wizard-friends
StandardOutput=journal
StandardError=journal
SyslogIdentifier=wizard-friends
[Install]
WantedBy=multi-user.target
SERVICE
# This file has its own listener or exact HTTPS server_name. Existing athlete
# production/preview files, certificate settings and listeners are untouched.
exec 8>/run/lock/game-sites.configure.lock
flock --wait 120 8
install -d -o root -g root -m 0755 /var/www/wizard-friends-acme
/opt/node/bin/node "$SOURCE/site-config.mjs" render > /etc/nginx/sites-available/wizard-friends.next
# Parse the new site even when it has not yet been enabled. Never leave a bad
# replacement in the active include path after a failed syntax check.
NGINX_TEST=$(mktemp)
trap 'rm -f -- "$NGINX_TEST" /etc/nginx/sites-available/wizard-friends.next' EXIT
printf 'pid /run/wizard-nginx-prepare-test.pid; events {} http { include /etc/nginx/mime.types; include /etc/nginx/sites-available/wizard-friends.next; }\n' > "$NGINX_TEST"
nginx -t -c "$NGINX_TEST"
if [[ -f /etc/nginx/sites-available/wizard-friends ]]; then cp -p /etc/nginx/sites-available/wizard-friends /etc/nginx/sites-available/wizard-friends.before-prepare; fi
mv /etc/nginx/sites-available/wizard-friends.next /etc/nginx/sites-available/wizard-friends
if ! nginx -t; then
  if [[ -f /etc/nginx/sites-available/wizard-friends.before-prepare ]]; then mv /etc/nginx/sites-available/wizard-friends.before-prepare /etc/nginx/sites-available/wizard-friends; else rm -f /etc/nginx/sites-available/wizard-friends; fi
  exit 1
fi
flock -u 8
cat > /etc/sudoers.d/wizard-friends-deploy <<'SUDO'
Defaults:wizard-deploy env_reset, !setenv
wizard-deploy ALL=(root) NOPASSWD: /usr/local/sbin/wizard-friends-ci-install *
SUDO
chmod 0440 /etc/sudoers.d/wizard-friends-deploy
visudo --check --file /etc/sudoers.d/wizard-friends-deploy
cat > /etc/cron.daily/wizard-friends-backup <<'BACKUP'
#!/usr/bin/env bash
exec /bin/bash /usr/local/lib/wizard-friends-deploy/backup.sh
BACKUP
chmod 0750 /etc/cron.daily/wizard-friends-backup
systemctl daemon-reload
echo 'Wizard users, directories, isolated installer and inactive site prepared. No game release started, no security group changed.'
echo 'The first checked main release enables only the Wizard site after its loopback probe passes.'
