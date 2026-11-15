#!/usr/bin/env bash
# Run after both the domain and www resolve to this VM; reuse the ACME account.
set -euo pipefail
if [[ $EUID -ne 0 || $# -ne 1 ]]; then
  echo 'Usage: sudo bash enable-domain.sh DOMAIN' >&2
  exit 2
fi
domain=$1
python3 -c 'import re,sys; assert re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+",sys.argv[1])' "$domain"
test -s /etc/nasa2026/public-ip
/opt/nasa2026-certbot/bin/certbot certonly --non-interactive \
  --webroot --webroot-path /var/www/acme \
  --cert-name "$domain" -d "$domain" -d "www.$domain"
previous_domain=''
[[ ! -e /etc/nasa2026/domain ]] || previous_domain=$(cat /etc/nasa2026/domain)
printf '%s\n' "$domain" > /etc/nasa2026/domain
chmod 600 /etc/nasa2026/domain
if ! bash "$(dirname -- "$0")/configure-proxy.sh"; then
  if [[ -n "$previous_domain" ]]; then
    printf '%s\n' "$previous_domain" > /etc/nasa2026/domain
  else
    rm -f /etc/nasa2026/domain
  fi
  exit 1
fi
systemctl is-active nasa2026-certbot.timer
echo "Domain enabled: https://$domain"
