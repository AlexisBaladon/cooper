#!/usr/bin/env bash
# One-time migration of an existing demo to release directories.
set -euo pipefail
if [[ $EUID -ne 0 || $# -ne 1 ]]; then
  echo "Usage: sudo bash enable-ci.sh PUBLIC_IPV4" >&2
  exit 2
fi
public_ip=$1
python3 -c 'import ipaddress,sys; assert ipaddress.IPv4Address(sys.argv[1]).is_global' "$public_ip"
backup=$(mktemp -d /tmp/nasa2026-ci-config.XXXXXX)
cp /etc/systemd/system/nasa2026-api.service "$backup/nasa2026-api.service"
cp /etc/nginx/sites-available/default "$backup/nginx.conf"
config_changed=false
restore() {
  result=$?
  trap - EXIT
  if [[ $result -ne 0 && $config_changed == true ]]; then
    install -m 644 "$backup/nasa2026-api.service" /etc/systemd/system/nasa2026-api.service
    install -m 644 "$backup/nginx.conf" /etc/nginx/sites-available/default
    systemctl daemon-reload
    systemctl restart nasa2026-api
    nginx -t && systemctl reload nginx
  fi
  rm -f -- "$backup/nasa2026-api.service" "$backup/nginx.conf"
  rmdir "$backup"
  exit "$result"
}
trap restore EXIT
if [[ ! -e /opt/nasa2026/current ]]; then
  bootstrap=/opt/nasa2026/releases/bootstrap
  install -d -m 755 "$bootstrap"
  cp -a /opt/nasa2026/backend /opt/nasa2026/frontend /opt/nasa2026/data "$bootstrap/"
  python3 -m venv "$bootstrap/venv"
  "$bootstrap/venv/bin/pip" install --disable-pip-version-check -r "$bootstrap/backend/requirements.txt"
  chown -R root:root "$bootstrap"
  chmod -R a+rX "$bootstrap"
  ln -s "$bootstrap" /opt/nasa2026/current
fi
# Keep existing releases usable for rollback across the layout migration.
for release in /opt/nasa2026/releases/*; do
  if [[ -d "$release/backend" ]]; then
    ln -sfnT backend "$release/runtime"
    ln -sfnT frontend "$release/public"
  elif [[ -d "$release/api" && -d "$release/web/out" ]]; then
    ln -sfnT api "$release/runtime"
    ln -sfnT web/out "$release/public"
  fi
done
if [[ ! -e /opt/nasa2026/previous ]]; then
  ln -s "$(readlink -f /opt/nasa2026/current)" /opt/nasa2026/previous
fi
install -m 755 /opt/nasa2026/deploy/vm/activate-release.sh /usr/local/sbin/nasa2026-activate
config_changed=true
install -m 644 /opt/nasa2026/deploy/vm/nasa2026-api.service /etc/systemd/system/nasa2026-api.service
sed "s/PUBLIC_IP/$public_ip/g" /opt/nasa2026/deploy/vm/nginx-https.conf.template > /etc/nginx/sites-available/default
nginx -t
systemctl daemon-reload
systemctl restart nasa2026-api
curl --fail --silent --retry 15 --retry-connrefused --retry-delay 1 --max-time 3 http://127.0.0.1:8000/health
systemctl reload nginx
echo "Release-directory deployment enabled."
