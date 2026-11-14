"""Smoke-check the Cooper deployment; optional real NASA sample analysis."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("url", help="HTTPS origin of a deployment you own")
    parser.add_argument("--analyze-sample", action="store_true", help="Also fetch NASA data for the first sample field")
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
            with urlopen(req, timeout=180 if path == "/api/analyze" else 20) as response:
                return response.status, response.read()
        except HTTPError as error:
            return error.code, error.read()

    checks = {}
    code, page = request("/")
    assert code == 200 and b"Cooper" in page, (code, "homepage")
    checks["homepage_https"] = code
    code, health = request("/api/health")
    assert code == 200 and json.loads(health)["status"] == "ok"
    checks["backend_health"] = code
    code, catalog_body = request("/api/catalog")
    catalog = json.loads(catalog_body)
    assert code == 200 and catalog["rotaciones"] and catalog["campos_demo"]
    checks["catalog"] = code
    code, _ = request("/api/analyze", b"{}")
    assert code == 422, code
    checks["request_validation"] = code
    if args.analyze_sample:
        field = catalog["campos_demo"][0]
        body = json.dumps({"lat": field["lat"], "lon": field["lon"], "rotacion_actual": field["rotacion"], "tiene_ganado": field["tiene_ganado"]}).encode()
        code, analysis_body = request("/api/analyze", body)
        assert code == 200, (code, analysis_body[:500])
        result = json.loads(analysis_body)
        assert len(result["rotaciones"]) == 3 and len(result["clima"]["mensual"]) == 12
        checks["nasa_sample_analysis"] = {"status": code, "period": result["meta"]["periodo"]}
    for path in ("/api/docs", "/api/climate/power", "/api/openai", "/api/groq"):
        code, _ = request(path)
        assert code == 404, (path, code)
        checks[path] = code
    code, _ = request("/.env")
    assert code in (403, 404), code
    checks["hidden_files_blocked"] = code
    code, _ = request("/api/analyze", b" " * 20000)
    assert code == 413, code
    checks["oversized_body_blocked"] = code
    with ThreadPoolExecutor(max_workers=12) as pool:
        codes = list(pool.map(lambda _: request("/api/catalog")[0], range(12)))
    assert 429 in codes and all(code in (200, 429) for code in codes), codes
    checks["rate_limit"] = {str(code): codes.count(code) for code in set(codes)}
    print(json.dumps(checks, indent=2))


if __name__ == "__main__":
    main()
