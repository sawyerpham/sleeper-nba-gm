#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 VM (Oracle Cloud Always Free, Ampere A1), run as the default user:
#   bash setup.sh https://github.com/<you>/<repo>.git
# Installs Docker from Ubuntu's own packages, opens ports 80/443 in the VM's firewall, clones the repo to ~/app and
# adds the daily backup to cron. Then fill in the two .env files and start it (README, Deploy).
set -euo pipefail
repo="${1:?usage: bash setup.sh <git repo url>}"

sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 git iptables-persistent
sudo usermod -aG docker "$USER"

# Oracle's Ubuntu images reject everything but SSH in iptables; the rules go before that REJECT.
for spec in tcp:80 tcp:443 udp:443; do
  proto=${spec%:*} port=${spec#*:}
  sudo iptables -C INPUT -p "$proto" --dport "$port" -j ACCEPT 2>/dev/null ||
    sudo iptables -I INPUT 5 -p "$proto" --dport "$port" -j ACCEPT
done
sudo netfilter-persistent save

[ -d ~/app ] || git clone "$repo" ~/app
mkdir -p ~/app/backend/data

line="0 9 * * * cd $HOME/app/deploy && docker compose -f compose.prod.yml exec -T app python -m app.backup >> $HOME/backup.log 2>&1"
(crontab -l 2>/dev/null | grep -v app.backup; echo "$line") | crontab -

echo "Done. Log out and back in (for the docker group), then follow README > Deploy from step 4."
