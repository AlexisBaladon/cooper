#!/usr/bin/env bash
set -euo pipefail
if [[ $EUID -ne 0 || $# -ne 1 ]]; then
  echo "Usage: sudo bash enable-https.sh PUBLIC_IPV4" >&2
  exit 1
fi
public_ip=$1
python3 -c 'import ipaddress,sys; p=ipaddress.ip_address(sys.argv[1]); assert p.version == 4 and p.is_global' "$public_ip"
python3 -m venv /opt/nasa2026-certbot
/opt/nasa2026-certbot/bin/pip install 'certbot>=5.4,<6'
/opt/nasa2026-certbot/bin/certbot certonly --non-interactive --agree-tos \
  --register-unsafely-without-email --webroot --webroot-path /var/www/acme \
  --ip-address "$public_ip" --preferred-profile shortlived --cert-name "$public_ip"
sed "s/PUBLIC_IP/$public_ip/g" /opt/nasa2026/deploy/vm/nginx-https.conf.template > /etc/nginx/sites-available/default
nginx -t
systemctl reload nginx
install -m 644 /opt/nasa2026/deploy/vm/nasa2026-certbot.service /etc/systemd/system/nasa2026-certbot.service
install -m 644 /opt/nasa2026/deploy/vm/nasa2026-certbot.timer /etc/systemd/system/nasa2026-certbot.timer
systemctl daemon-reload
systemctl enable --now nasa2026-certbot.timer
/opt/nasa2026-certbot/bin/certbot renew --dry-run --run-deploy-hooks \
  --deploy-hook 'systemctl reload nginx'
echo "HTTPS configured: https://$public_ip"
