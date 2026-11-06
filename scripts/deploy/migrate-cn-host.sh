#!/usr/bin/env bash
# Update only the existing Wizard host tools/config; do not install an app release.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run the reviewed migration as root.' >&2; exit 1; }
[[ -f /etc/wizard-friends/server.env ]] || { echo 'This migration requires the existing Wizard service.' >&2; exit 1; }
SOURCE=$(cd -- "$(dirname -- "$0")" && pwd)
export PUBLIC_ORIGIN=${PUBLIC_ORIGIN:-https://wizard.magical-athlete-online.cn}
export PORT=${PORT:-3002}
export LEGACY_PUBLIC_ORIGIN=${LEGACY_PUBLIC_ORIGIN:-http://115.29.188.62:8081}
# bootstrap validates exact-host TLS, backs up Wizard config and online SQLite,
# checks existing ports/data paths, patches the env, updates fixed
# tools, stops this game's audit jobs and validates its own Nginx replacement.
# It does not restart the game or change current/previous release pointers.
bash "$SOURCE/bootstrap.sh"
# Serialize the reload with the other games' independently prepared vhosts.
/usr/bin/flock --wait 120 /run/lock/game-sites.configure.lock /bin/bash -euc 'nginx -t; systemctl reload nginx'
echo 'Wizard cn host migration complete. Existing game release still runs; release the checked main artifact next.'
