#!/usr/bin/env bash
# Run on the dedicated Debian/Ubuntu VM after copying the built release to /opt/nasa2026.
set -euo pipefail
if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo on the dedicated VM." >&2
  exit 1
fi
test -f /opt/nasa2026/web/out/index.html
test -f /opt/nasa2026/api/pyproject.toml
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
python3 -m venv /opt/nasa2026/venv
/opt/nasa2026/venv/bin/pip install /opt/nasa2026/api
install -d -m 755 /var/www/acme
install -d -m 700 /etc/nasa2026
if [[ ! -e /etc/nasa2026/ai-keys.env ]]; then
  install -m 600 /dev/null /etc/nasa2026/ai-keys.env
fi
install -m 644 /opt/nasa2026/deploy/vm/nasa2026-api.service /etc/systemd/system/nasa2026-api.service
install -m 644 /opt/nasa2026/deploy/vm/nginx-http.conf /etc/nginx/sites-available/default
systemctl daemon-reload
systemctl enable nasa2026-api
systemctl restart nasa2026-api
nginx -t
systemctl enable nginx
systemctl restart nginx
curl --fail --silent --retry 10 --retry-connrefused --retry-delay 1 --max-time 3 http://127.0.0.1:8000/health
echo "API ready locally. Public site stays closed until HTTPS setup is complete."
