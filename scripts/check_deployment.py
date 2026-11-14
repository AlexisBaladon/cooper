"""Smoke-check our public demo with TLS verification and no provider API calls."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("url", help="HTTPS origin of a deployment you own")
    args = parser.parse_args()
    base = args.url.rstrip("/")
    parsed = urlsplit(base)
    if parsed.scheme != "https" or not parsed.netloc or parsed.path:
        raise SystemExit("Use an HTTPS origin without a path")

    def request(path: str, body: bytes | None = None) -> tuple[int, bytes]:
        req = Request(base + path, data=body)
        if body is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urlopen(req, timeout=20) as response:
                return response.status, response.read()
        except HTTPError as error:
            return error.code, error.read()

    checks = {}
    code, page = request("/")
    assert code == 200 and b"Space Apps" in page, (code, "homepage")
    checks["homepage_https"] = code
    code, health = request("/api/health")
    assert code == 200 and json.loads(health)["status"] == "ok"
    checks["backend_health"] = code
    body = json.dumps({"priority": "agua", "rain_change_percent": -20}).encode()
    code, comparison = request("/api/compare", body)
    result = json.loads(comparison)
    assert code == 200 and len(result["options"]) == 3
    assert result["status"] == "illustrative_only"
    checks["comparison"] = code
    for path in ("/api/docs", "/api/climate/power", "/api/openai", "/api/groq"):
        code, _ = request(path)
        assert code == 404, (path, code)
        checks[path] = code
    code, _ = request("/.env")
    assert code in (403, 404), code
    checks["hidden_files_blocked"] = code
    code, _ = request("/api/compare", b" " * 20000)
    assert code == 413, code
    checks["oversized_body_blocked"] = code
    with ThreadPoolExecutor(max_workers=12) as pool:
        codes = list(pool.map(lambda _: request("/api/compare", body)[0], range(12)))
    assert 429 in codes and all(code in (200, 429) for code in codes), codes
    checks["rate_limit"] = {str(code): codes.count(code) for code in set(codes)}
    print(json.dumps(checks, indent=2))


if __name__ == "__main__":
    main()
