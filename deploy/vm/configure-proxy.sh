#!/usr/bin/env bash
# Apply the release's proxy configuration, preserving the server's domain.
set -euo pipefail
[[ $EUID -eq 0 && $# -le 1 ]] || exit 2
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
public_ip=${1:-$(cat /etc/nasa2026/public-ip)}
python3 -c 'import ipaddress,sys; assert ipaddress.IPv4Address(sys.argv[1]).is_global' "$public_ip"
domain=''
if [[ -s /etc/nasa2026/domain ]]; then
  domain=$(cat /etc/nasa2026/domain)
  python3 -c 'import re,sys; assert re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+",sys.argv[1])' "$domain"
  test -s "/etc/letsencrypt/live/$domain/fullchain.pem"
fi
install -d -m 700 /etc/nasa2026
install -d -m 755 /etc/nginx/snippets
backup=$(mktemp -d /tmp/nasa2026-proxy.XXXXXX)
cp /etc/nginx/sites-available/default "$backup/default"
if [[ -e /etc/nginx/snippets/nasa2026-app.conf ]]; then
  cp /etc/nginx/snippets/nasa2026-app.conf "$backup/app.conf"
fi
restore() {
  result=$?
  trap - EXIT
  if [[ $result -ne 0 ]]; then
    install -m 644 "$backup/default" /etc/nginx/sites-available/default
    if [[ -e "$backup/app.conf" ]]; then
      install -m 644 "$backup/app.conf" /etc/nginx/snippets/nasa2026-app.conf
    else
      rm -f /etc/nginx/snippets/nasa2026-app.conf
    fi
    nginx -t && systemctl reload nginx
  fi
  rm -f -- "$backup/default" "$backup/app.conf"
  rmdir "$backup"
  exit "$result"
}
trap restore EXIT
install -m 644 "$source_dir/nginx-app.conf" /etc/nginx/snippets/nasa2026-app.conf
sed "s/PUBLIC_IP/$public_ip/g" "$source_dir/nginx-https.conf.template" > /etc/nginx/sites-available/default
if [[ -n "$domain" ]]; then
  sed "s/DOMAIN/$domain/g" "$source_dir/nginx-domain.conf.template" >> /etc/nginx/sites-available/default
fi
nginx -t
systemctl reload nginx
printf '%s\n' "$public_ip" > /etc/nasa2026/public-ip
chmod 600 /etc/nasa2026/public-ip
