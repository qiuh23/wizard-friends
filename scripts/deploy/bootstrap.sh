#!/usr/bin/env bash
# Reviewed one-time host preparation. Never edits the athlete installation.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root from the reviewed Wizard checkout.' >&2; exit 1; }
PUBLIC_ORIGIN=${PUBLIC_ORIGIN:-http://115.29.188.62:8081}
PUBLIC_PORT=${PUBLIC_PORT:-8081}
PORT=${PORT:-3002}
for value in "$PORT" "$PUBLIC_PORT"; do [[ $value =~ ^[0-9]+$ && $value -ge 1024 && $value -le 65535 && ! $value =~ ^(3000|3001|8080)$ ]] || { echo 'Invalid or athlete-reserved port.' >&2; exit 1; }; done
[[ $PORT != "$PUBLIC_PORT" ]]
/opt/node/bin/node --input-type=module -e 'const u=new URL(process.argv[1]);if(u.origin!==process.argv[1]||u.protocol!=="http:"||u.username||u.password||u.port!==process.argv[2])throw Error("Set exact HTTP public origin including configured port");if(Number(process.versions.node.split(".")[0])!==24)throw Error("Require existing Node 24");' "$PUBLIC_ORIGIN" "$PUBLIC_PORT"
for command in nginx sqlite3 python3 flock visudo curl ss; do command -v "$command" >/dev/null || { echo "Missing existing host prerequisite: $command" >&2; exit 1; }; done
SOURCE=$(cd -- "$(dirname -- "$0")" && pwd)
exec 9>/run/lock/wizard-friends.deploy.lock
flock --wait 900 9
if [[ ! -f /etc/wizard-friends/server.env ]]; then
  for value in "$PORT" "$PUBLIC_PORT"; do [[ -z $(ss -H -ltn "sport = :$value") ]] || { echo "Port $value is occupied; choose another port before installation." >&2; exit 1; }; done
fi
for account in wizard wizard-deploy; do id "$account" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$account"; done
install -d -o root -g wizard -m 0750 /opt/wizard-friends /opt/wizard-friends/releases /etc/wizard-friends
install -d -o wizard -g wizard -m 0750 /var/lib/wizard-friends /var/log/wizard-friends
install -d -o root -g root -m 0700 /var/backups/wizard-friends /var/lib/wizard-friends-deploy-state
# Preserve only this game's previous host configuration before replacing its
# fixed installer, service or site. Existing immutable app releases are retained.
bash "$SOURCE/backup.sh"
install -d -o root -g root -m 0755 /usr/local/lib/wizard-friends-deploy
for file in install.mjs unpack.py backup.sh probe.mjs; do install -o root -g root -m 0644 "$SOURCE/$file" "/usr/local/lib/wizard-friends-deploy/$file"; done
install -o root -g root -m 0755 "$SOURCE/ci-install.sh" /usr/local/sbin/wizard-friends-ci-install
if [[ ! -f /etc/wizard-friends/server.env ]]; then
  cat > /etc/wizard-friends/server.env <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=$PORT
DATABASE_PATH=/var/lib/wizard-friends/rooms.sqlite
STATIC_DIR=/opt/wizard-friends/current/dist
PUBLIC_ORIGIN=$PUBLIC_ORIGIN
BACKENDS_CONFIG_JSON='{"backends":[{"id":"cloudflare","origin":"https://wizard-friends.qiuh23.workers.dev","enabled":true},{"id":"aliyun","origin":"$PUBLIC_ORIGIN","enabled":false}]}'
EOF
  chown root:wizard /etc/wizard-friends/server.env
  chmod 0640 /etc/wizard-friends/server.env
else
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
# This file has its own listener and name. Existing athlete sites are untouched.
exec 8>/run/lock/game-sites.configure.lock
flock --wait 120 8
cat > /etc/nginx/sites-available/wizard-friends <<EOF
server {
    listen $PUBLIC_PORT;
    server_name _;
    client_max_body_size 256k;
    access_log /var/log/nginx/wizard-friends.access.log;
    error_log /var/log/nginx/wizard-friends.error.log;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$http_host;
        proxy_set_header Origin \$http_origin;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 100s;
        proxy_send_timeout 100s;
        proxy_buffering off;
    }
}
EOF
nginx -t
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
