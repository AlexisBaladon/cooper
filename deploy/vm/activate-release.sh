#!/usr/bin/env bash
# Installed as /usr/local/sbin/nasa2026-activate. Receives a verified CI release.
set -euo pipefail
if [[ $EUID -ne 0 || $# -ne 1 || ! $1 =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]]; then
  echo "Usage: sudo nasa2026-activate COMMIT-RUN-ATTEMPT" >&2
  exit 2
fi
release_id=$1
archive="/tmp/nasa2026-$release_id.tar.gz"
release="/opt/nasa2026/releases/$release_id"
active=/opt/nasa2026/current
exec 9>/run/lock/nasa2026-deploy.lock
flock -w 120 9
test -f "$archive"
test -L "$active"
previous=$(readlink -f "$active")
if [[ -e "$release" ]]; then
  echo "Release directory already exists; refusing to overwrite it." >&2
  exit 1
fi
install -d -m 755 "$release"
python3 - "$archive" "$release" <<'PY'
import pathlib, sys, tarfile
with tarfile.open(sys.argv[1]) as source:
    for item in source.getmembers():
        p = pathlib.PurePosixPath(item.name)
        if p.is_absolute() or '..' in p.parts or item.issym() or item.islnk():
            raise SystemExit('Unsafe archive member')
        if not (item.isfile() and (p.parts[:2] == ('api', 'app') or item.name == 'api/pyproject.toml' or p.parts[:2] == ('web', 'out') or p.parts[:2] == ('deploy', 'vm'))):
            raise SystemExit('Unexpected archive member')
    source.extractall(sys.argv[2], filter='data')
PY
test -f "$release/web/out/index.html"
test -f "$release/api/app/main.py"
chown -R root:root "$release"
chmod -R a+rX "$release"
python3 -m venv "$release/venv"
"$release/venv/bin/pip" install --disable-pip-version-check "$release/api"
printf '%s\n' "${release_id:0:40}" > "$release/RELEASE"
printf '{"commit":"%s","release":"%s"}\n' "${release_id:0:40}" "$release_id" > "$release/web/out/version.json"

switched=false
rollback() {
  result=$?
  trap - EXIT
  if [[ $result -ne 0 && $switched == true ]]; then
    ln -sfn "$previous" /opt/nasa2026/current.rollback
    mv -Tf /opt/nasa2026/current.rollback "$active"
    systemctl restart nasa2026-api
    curl --fail --silent --retry 15 --retry-connrefused --retry-delay 1 --max-time 3 http://127.0.0.1:8000/health > /dev/null || true
    echo "Deployment failed; restored the previous release." >&2
  fi
  exit "$result"
}
trap rollback EXIT
switched=true
ln -sfnT "$previous" /opt/nasa2026/previous.next
mv -Tf /opt/nasa2026/previous.next /opt/nasa2026/previous
ln -sfnT "$release" /opt/nasa2026/current.next
mv -Tf /opt/nasa2026/current.next "$active"
systemctl restart nasa2026-api
curl --fail --silent --retry 15 --retry-connrefused --retry-delay 1 --max-time 3 http://127.0.0.1:8000/health > /dev/null
curl --fail --silent --max-time 5 -H 'Content-Type: application/json' \
  -d '{"priority":"agua","rain_change_percent":-20}' http://127.0.0.1:8000/compare \
  | python3 -c 'import json,sys; r=json.load(sys.stdin); assert len(r["options"]) == 3'
nginx -t
curl --fail --silent --max-time 5 http://127.0.0.1:8000/health

# Keep the active release and its predecessor plus at most one older release.
# Check resolved paths before deleting any directory, and never touch secrets/state.
python3 - "$release" "$previous" <<'PY'
from pathlib import Path
import re, shutil, sys
base = Path('/opt/nasa2026/releases').resolve()
keep = {Path(p).resolve() for p in sys.argv[1:]}
older = sorted((p for p in base.iterdir() if p.resolve() not in keep), key=lambda p: p.stat().st_mtime, reverse=True)
for p in older[1:]:
    if not p.is_symlink() and p.is_dir() and p.resolve().parent == base and re.fullmatch(r'[a-f0-9]{40}-[0-9]+-[0-9]+', p.name):
        shutil.rmtree(p)
PY
echo "Activated release $release_id"
