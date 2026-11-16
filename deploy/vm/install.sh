#!/usr/bin/env bash
# Run on the dedicated Debian/Ubuntu VM after copying the built release to /opt/nasa2026.
set -euo pipefail
if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo on the dedicated VM." >&2
  exit 1
fi
test -f /opt/nasa2026/frontend/index.html
test -f /opt/nasa2026/backend/requirements.txt
# Give package installation and certificate renewal some headroom on 512 MB VMs.
if [[ $(awk '/MemTotal/ {print $2}' /proc/meminfo) -lt 786432 ]] && ! swapon --noheadings --show | grep -q .; then
  if [[ ! -e /swapfile ]]; then
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    printf '%s\n' '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y nginx python3-venv ca-certificates unattended-upgrades
if [[ ! -e /opt/nasa2026/current ]]; then
  bootstrap=/opt/nasa2026/releases/bootstrap
  install -d -m 755 "$bootstrap"
  cp -a /opt/nasa2026/backend /opt/nasa2026/frontend /opt/nasa2026/data "$bootstrap/"
  python3 -m venv "$bootstrap/venv"
  "$bootstrap/venv/bin/pip" install -r "$bootstrap/backend/requirements.txt"
  ln -s backend "$bootstrap/runtime"
  ln -s frontend "$bootstrap/public"
  ln -s "$bootstrap" /opt/nasa2026/current
  ln -s "$bootstrap" /opt/nasa2026/previous
fi
install -d -m 755 /var/www/acme
install -d -m 700 /etc/nasa2026
if [[ ! -e /etc/nasa2026/ai-keys.env ]]; then
  install -m 600 /dev/null /etc/nasa2026/ai-keys.env
fi
install -m 644 /opt/nasa2026/deploy/vm/nasa2026-api.service /etc/systemd/system/nasa2026-api.service
install -m 755 /opt/nasa2026/deploy/vm/activate-release.sh /usr/local/sbin/nasa2026-activate
install -m 644 /opt/nasa2026/deploy/vm/nginx-http.conf /etc/nginx/sites-available/default
systemctl daemon-reload
systemctl enable nasa2026-api
systemctl restart nasa2026-api
nginx -t
systemctl enable nginx
systemctl restart nginx
curl --fail --silent --retry 10 --retry-connrefused --retry-delay 1 --max-time 3 http://127.0.0.1:8000/health
echo "API ready locally. Public site stays closed until HTTPS setup is complete."
