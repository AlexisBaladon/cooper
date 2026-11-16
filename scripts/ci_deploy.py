"""Deploy one checked release using short-lived AWS/SSH credentials."""

import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
from urllib.request import ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
INSTANCE = "nasa2026-demo"
REGION = "us-east-1"
STATE = Path(os.environ.get("RUNNER_TEMP", str(ROOT / ".git"))) / "nasa2026-deploy-state.json"


def aws(operation: str, *args: str):
    result = subprocess.run(
        ["aws", "lightsail", operation, "--region", REGION, "--no-cli-pager", "--output", "json", *args],
        capture_output=True, text=True, timeout=45,
    )
    if result.returncode:
        raise RuntimeError(f"AWS {operation} failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


def port_info(cidr: str) -> str:
    return json.dumps({"fromPort": 22, "toPort": 22, "protocol": "tcp", "cidrs": [cidr]})


def cleanup() -> None:
    if not STATE.exists():
        return
    state = json.loads(STATE.read_text())
    cidr = str(ipaddress.IPv4Network(state["cidr"], strict=True))
    # Closing only this /32 preserves the administrator's existing SSH rule.
    aws("close-instance-public-ports", "--instance-name", INSTANCE, "--port-info", port_info(cidr))
    STATE.unlink()
    print("Closed temporary runner SSH access.", flush=True)


def mask(value: str) -> None:
    if os.environ.get("GITHUB_ACTIONS") == "true":
        escaped = value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        print(f"::add-mask::{escaped}", flush=True)


def deploy() -> None:
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise RuntimeError("Use this deploy command only in GitHub Actions; local operators should use their existing SSH access")
    commit = os.environ["DEPLOY_COMMIT"]
    run = os.environ["DEPLOY_RUN_ID"]
    attempt = os.environ["DEPLOY_ATTEMPT"]
    release_id = f"{commit}-{run}-{attempt}"
    if not re.fullmatch(r"[a-f0-9]{40}-[0-9]+-[0-9]+", release_id):
        raise ValueError("Invalid release identifier")
    archive = ROOT / "dist/nasa2026-release.tar.gz"
    if not archive.is_file():
        raise FileNotFoundError("Build and package the release first")
    ip = "52.71.101.193"
    user = "ubuntu"
    # No proxy: the firewall must allow the IP of the actual SSH connection.
    opener = build_opener(ProxyHandler({}))
    with opener.open("https://checkip.amazonaws.com", timeout=15) as response:
        runner_ip = str(ipaddress.IPv4Address(response.read().decode().strip()))
    cidr = runner_ip + "/32"
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps({"cidr": cidr}))
    try:
        aws("open-instance-public-ports", "--instance-name", INSTANCE, "--port-info", port_info(cidr))
        details = aws("get-instance-access-details", "--instance-name", INSTANCE, "--protocol", "ssh")["accessDetails"]
        if details["username"] != user or details["ipAddress"] != ip or details["instanceName"] != INSTANCE:
            raise RuntimeError("Instance identity/IP changed; review deployment access")
        with tempfile.TemporaryDirectory(prefix="nasa2026-ssh-", dir=STATE.parent) as directory:
            key = Path(directory) / "deploy-key"
            certificate = Path(directory) / "deploy-key-cert.pub"
            for path, value in ((key, details["privateKey"]), (certificate, details["certKey"])):
                mask(value)
                descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                with os.fdopen(descriptor, "w") as stream:
                    stream.write(value.rstrip() + "\n")
            ssh_options = [
                "-i", str(key), "-o", f"CertificateFile={certificate}",
                "-o", f"UserKnownHostsFile={ROOT / 'deploy/aws-lightsail/known_hosts'}",
                "-o", "StrictHostKeyChecking=yes", "-o", "IdentitiesOnly=yes",
                "-o", "BatchMode=yes", "-o", "ConnectTimeout=15",
                "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
            ]
            target = f"{user}@{ip}"
            destination = f"/tmp/nasa2026-{release_id}.tar.gz"
            subprocess.run(["scp", *ssh_options, str(archive), f"{target}:{destination}"], check=True, timeout=120)
            subprocess.run(
                ["ssh", *ssh_options, target, f"sudo /usr/local/sbin/nasa2026-activate {release_id}"],
                check=True, timeout=600,
            )
        expected = {"commit": commit, "release": release_id}
        for retry in range(5):
            req = Request(f"https://{ip}/version.json", headers={"Cache-Control": "no-cache"})
            with opener.open(req, timeout=15) as response:
                actual = json.load(response)
            if actual == expected:
                break
            if retry == 4:
                raise RuntimeError("Public deployment version did not match the requested release")
            time.sleep(2)
        print(f"Verified public release {commit[:7]}: https://{ip}", flush=True)
        if os.environ.get("GITHUB_STEP_SUMMARY"):
            with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
                summary.write(f"Published `{commit[:7]}` to https://{ip}\n")
    finally:
        cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["deploy", "cleanup"])
    args = parser.parse_args()
    if args.command == "deploy":
        deploy()
    else:
        cleanup()
