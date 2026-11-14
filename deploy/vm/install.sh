#!/usr/bin/env bash
# Run on the dedicated Debian VM after copying the built release to /opt/nasa2026.
set -euo pipefail
if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo on the dedicated VM." >&2
  exit 1
fi
test -f /opt/nasa2026/web/out/index.html
test -f /opt/nasa2026/api/pyproject.toml
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y nginx python3-venv ca-certificates unattended-upgrades
python3 -m venv /opt/nasa2026/venv
/opt/nasa2026/venv/bin/pip install /opt/nasa2026/api
install -d -m 755 /var/www/acme
install -m 644 /opt/nasa2026/deploy/vm/nasa2026-api.service /etc/systemd/system/nasa2026-api.service
install -m 644 /opt/nasa2026/deploy/vm/nginx-http.conf /etc/nginx/sites-available/default
systemctl daemon-reload
systemctl enable --now nasa2026-api
nginx -t
systemctl enable nginx
systemctl restart nginx
curl --fail --silent http://127.0.0.1:8000/health
echo "API ready locally. Public site stays closed until HTTPS setup is complete."
