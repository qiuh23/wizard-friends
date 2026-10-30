#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 1 && $EUID -eq 0 && ${SUDO_USER:-} == wizard-deploy ]] || { echo 'Use the fixed wizard-deploy sudo entrypoint.' >&2; exit 1; }
exec /usr/bin/flock --wait 900 /run/lock/wizard-friends.deploy.lock /opt/node/bin/node /usr/local/lib/wizard-friends-deploy/install.mjs "$1"
