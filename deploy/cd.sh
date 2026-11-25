#!/bin/sh
# Continuous deployment entry point. The GitHub Actions deploy key may run only this script (it is the forced
# command on that key in ~/.ssh/authorized_keys), so a leaked key can redeploy main but do nothing else.
set -eu
cd /home/ubuntu/app
git pull --ff-only --quiet
cd deploy
docker compose -f compose.prod.yml up -d --build --wait
docker image prune -f >/dev/null
echo "deployed $(git rev-parse --short HEAD)"
