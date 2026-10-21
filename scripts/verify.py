"""Generate bounded audit/foundation evidence; never infer live provider success."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from scripts.skill_audit import ROOT, main as audit_skills

EVIDENCE = ROOT / "docs/evidence"
SUITES = {
    "offline": [["npm", "run", "build"], [sys.executable, "-m", "unittest", "discover", "-s", "tests/offline", "-v"]],
    "contracts": [["node", "--test", "tests/contracts/sdk.test.mjs"]],
    "security": [["npm", "run", "build"], ["npm", "run", "test:foundation"], [sys.executable, "-m", "unittest", "discover", "-s", "tests/security", "-v"]],
}


def now():
    return datetime.now(timezone.utc).isoformat()


def source_hash():
    files = {}
    for directory in ["scripts", "tests", "contracts", "apps", "database"]:
        for path in sorted((ROOT / directory).rglob("*")):
            if path.is_file() and "__pycache__" not in path.parts:
                files[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
    for name in ["package.json", "package-lock.json", "pyproject.toml", "uv.lock", "Makefile", "tsconfig.json"]:
        files[name] = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
    return hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()


def write_status():
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True)
    refs = [f"docs/evidence/{name}.json" for name in SUITES if (EVIDENCE / f"{name}.json").exists()]
    integrations = {name: {"state": "NOT_IMPLEMENTED", "live_test": False, "evidence": refs,
                           "blocked_reason": "Product provider journey and authorized staging verification are not implemented; M0 audit evidence does not prove a working integration."}
                    for name in ["crawl4ai", "docling", "deepagents", "openai_images", "higgsfield_video", "creative_editor", "postiz_publish", "performance_learning", "tenant_runtime"]}
    integrations["tenant_runtime"]["blocked_reason"] = "Auth/workspace/brand/team APIs and RLS are implemented locally; private media storage, generation-worker authorization and deployed tenant journey remain incomplete."
    security_path = EVIDENCE / "security.json"
    security = json.loads(security_path.read_text()) if security_path.exists() else {}
    foundation_passed = (security.get("passed") is True and security.get("source_sha256") == source_hash()
                         and any(r.get("command") == ["npm", "run", "test:foundation"] and r.get("exit_code") == 0 for r in security.get("results", [])))
    integrations["workspace_auth"] = {"state": "ADAPTER_READY" if foundation_passed else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/security.json"],
        "blocked_reason": "Local HTTP/PostgreSQL/SMTP foundation tests only. External deployment, actual sender/delivery validation, invitation UX and broader tenant runtime remain incomplete."}
    integrations["account_email"] = {"state": "ADAPTER_READY" if foundation_passed else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/security.json"],
        "blocked_reason": "Encrypted queue, verification/reset/invitations and SMTP error paths tested against a local server only. Real sender credentials, deliverability, UI and operator retry/monitoring remain unverified/incomplete."}
    status = {"schema_version": 1, "generated_by": "python -m scripts.verify", "environment": "offline_dev",
              "code_commit": commit.stdout.strip() if commit.returncode == 0 else "uncommitted-M0",
              "checked_at": now(), "integrations": integrations,
              "security": {"tenant_isolation_passed": False, "secret_scan_passed": False}, "overall_release_state": "BLOCKED"}
    (EVIDENCE / "integration-status.json").write_text(json.dumps(status, indent=2) + "\n")
    return status


def run_suite(name):
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    if name == "offline":
        audit_skills()
    results = []
    for command in SUITES[name]:
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=180)
        log = result.stdout + result.stderr
        print(log, end="")
        results.append({"command": command, "exit_code": result.returncode, "output": log})
    scopes = {"offline": "TypeScript build and M0 skill archive/middleware probes", "contracts": "Pinned OpenAI/Higgsfield SDKs with MOCK transports", "security": "M0 guards plus real local HTTP auth, PostgreSQL RLS, brand retries/revisions, verified email/recovery/invitations, local SMTP failures, rollback and restart recovery; no external provider/private-media/generation-worker tenant proof"}
    report = {"suite": name, "scope": scopes[name], "checked_at": now(),
              "source_sha256": source_hash(), "results": results, "passed": all(x["exit_code"] == 0 for x in results), "live_calls": False}
    (EVIDENCE / f"{name}.json").write_text(json.dumps(report, indent=2) + "\n")
    write_status()
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(run_suite(sys.argv[1]))
