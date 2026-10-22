"""Generate bounded audit/foundation evidence; never infer live provider success."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from scripts.skill_audit import ROOT, main as audit_skills
from scripts.ui_control_evidence import update_matrix

EVIDENCE = ROOT / "docs/evidence"
SUITES = {
    "offline": [["npm", "run", "build"], [sys.executable, "-m", "unittest", "discover", "-s", "tests/offline", "-v"]],
    "browser": [["npm", "run", "build"], ["npm", "run", "test:browser"]],
    "contracts": [["npm", "run", "build"], ["node", "--test", "tests/contracts/sdk.test.mjs", "tests/contracts/intake.test.mjs", "tests/contracts/creative.test.mjs", "tests/contracts/planning.test.mjs", "tests/contracts/local-calendar.test.mjs"]],
    "security": [["npm", "run", "build"], ["npm", "audit", "--prefix", "apps/media", "--omit=dev", "--audit-level=moderate", "--json"], ["npm", "run", "test:foundation"], [sys.executable, "-m", "unittest", "discover", "-s", "tests/security", "-v"]],
}


def now():
    return datetime.now(timezone.utc).isoformat()


def source_hash():
    files = {}
    for directory in ["scripts", "tests", "contracts", "apps", "database"]:
        for path in sorted((ROOT / directory).rglob("*")):
            if path.is_file() and not set(path.parts).intersection({"__pycache__", ".next", "node_modules", ".venv"}) and not path.name.endswith(".tsbuildinfo"):
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
    integrations["tenant_runtime"]["blocked_reason"] = "Auth/workspace/brand/team APIs and RLS are implemented locally; deployed private storage, generation-worker authorization and deployed tenant journey remain incomplete."
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
    for capability in ["private_assets", "durable_asset_jobs"]:
        integrations[capability] = {"state": "ADAPTER_READY" if foundation_passed else "NOT_IMPLEMENTED", "live_test": False,
            "evidence": ["docs/evidence/security.json"],
            "blocked_reason": "Actual local Garage/ClamAV/Temporal tests only. Production IAM/CORS/TLS, retention, cleanup, UI, intake sandbox and deployed/provider workflows remain incomplete."}
    browser_path = EVIDENCE / "browser.json"
    browser = json.loads(browser_path.read_text()) if browser_path.exists() else {}
    browser_passed = browser.get("passed") is True and browser.get("source_sha256") == source_hash()
    integrations["customer_workspace_ui"] = {"state": "ADAPTER_READY" if foundation_passed and browser_passed else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/browser.json", "docs/evidence/security.json"],
        "blocked_reason": "Real local browser account/client/brand/team/upload flows only. Deployed ingress/CORS, email delivery, generation, editor and publishing UI remain incomplete."}
    for capability in ["docling", "brand_evidence", "business_accounts"]:
        integrations[capability] = {"state": "ADAPTER_READY" if foundation_passed else "NOT_IMPLEMENTED", "live_test": False,
            "evidence": ["docs/evidence/security.json"],
            "blocked_reason": "Real local document/parser/Temporal/RLS and account quota tests only. Docling coverage is embedded text, not OCR/visual/semantic inference. Full business roles, deployed sandbox, document vision and live provider journey remain incomplete."}
    integrations["v5_business_ui"] = {"state": "ADAPTER_READY" if foundation_passed and browser_passed else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/security.json", "docs/evidence/browser.json"],
        "blocked_reason": "Business navigation, scoped records, source review and saved goals/prefill fixtures are tested locally. Actual AI output quality, strategy/plan and creative/social workflows remain incomplete; unavailable controls are labeled honestly."}
    for capability in ["crawl4ai", "website_visual_evidence", "ai_brand_onboarding"]:
        integrations[capability] = {"state": "ADAPTER_READY" if foundation_passed and browser_passed else "NOT_IMPLEMENTED", "live_test": False,
            "evidence": ["docs/evidence/security.json", "docs/evidence/contracts.json", "docs/evidence/browser.json"],
            "blocked_reason": "Local real Crawl4AI/Chromium/private storage and RLS tests, MOCK website resources/model responses, saved AI prefill/visual-guidance browser fixtures and multimodal SDK image/citation/budget contracts. Real public rendered HTTP smoke is separately scoped. Deployed broker, actual visual-model quality, paid model evidence and full end-to-end product remain incomplete."}
    contracts_path = EVIDENCE / "contracts.json"
    contracts = json.loads(contracts_path.read_text()) if contracts_path.exists() else {}
    creative_ready = foundation_passed and browser_passed and contracts.get("passed") is True and contracts.get("source_sha256") == source_hash()
    for capability in ["deepagents", "openai_images", "creative_editor", "canvas_runtime", "creative_review"]:
        integrations[capability] = {"state": "ADAPTER_READY" if creative_ready else "NOT_IMPLEMENTED", "live_test": False,
            "evidence": ["docs/evidence/security.json", "docs/evidence/contracts.json", "docs/evidence/browser.json"],
            "blocked_reason": "Actual isolated Deep Agents with pinned owner skills, read-only brand context, real local Temporal/S3/RLS, Fabric text edits/PNG export and immutable approval tested. OpenAI planning/image create/edit transports are MOCK. No paid image quality proof, deployed sandbox, publishing, visual reference approval, video/carousel, complete credit reconciliation or production launch evidence."}
    integrations["content_slot_reviews"] = {"state": "ADAPTER_READY" if foundation_passed else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/security.json"],
        "blocked_reason": "Manual/AI plan persistence and channel-specific exact-version review tested locally. Slot generation attaches safely, preserves newer edits and recovers cached output; worker cannot approve. Calendar/channel inbox use real local APIs and MOCK models. OAuth/publishing and deployed/live evidence remain missing."}
    integrations["ai_content_planning"] = {"state": "ADAPTER_READY" if foundation_passed and contracts.get("passed") is True and contracts.get("source_sha256") == source_hash() else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/security.json", "docs/evidence/contracts.json"],
        "blocked_reason": "Actual isolated original marketing-plan/social/product-marketing skills, Temporal, immutable approved context, MOCK OpenAI Responses, bounded 30-slot generation, PostgreSQL persistence/RLS, budget holds and failure recovery tested. Deployed runtime, paid strategy/creative quality, semantic claim validation, broader channels and full product acceptance remain incomplete."}
    integrations["planning_review_ui"] = {"state": "ADAPTER_READY" if creative_ready else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/security.json", "docs/evidence/contracts.json", "docs/evidence/browser.json"],
        "blocked_reason": "Real local browser calendar/channel filtering, 30-day skill-driven plan, slot creative creation/revision, private preview, saved feedback, local-time rescheduling and confirmed bulk approval. MOCK OpenAI only. Full V5 formats, connected identities, exports/bulk submission, deployed runtime and live quality remain incomplete."}
    integrations["canonical_creative_exports"] = {"state": "ADAPTER_READY" if creative_ready else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/security.json", "docs/evidence/browser.json"],
        "blocked_reason": "Actual isolated Fabric/node renderer, pinned fonts, private immutable PNG, Temporal recovery, tenant isolation and explicit exact-pixel approvals tested locally. Font substitutions are disclosed and saved pixels are authoritative. No deployed renderer, publishing proof or video/carousel exports."}
    update_matrix(ROOT, foundation_passed and browser_passed, creative_ready)
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
    started_hash = source_hash()
    results = []
    for command in SUITES[name]:
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=600)
        log = result.stdout + result.stderr
        print(log, end="")
        results.append({"command": command, "exit_code": result.returncode, "output": log})
    scopes = {"browser": "Actual Chromium through V5 business UI and Canvas to real local HTTP/PostgreSQL/SMTP/S3/ClamAV/Temporal; actual isolated owner skills, MOCK OpenAI generation/edit, Fabric edits/export, version approval and uncertain-outcome holds; calendar planning, linked creative generation/revision, feedback and bulk channel review with MOCK providers; manual onboarding/approved memory, scope, quota, recovery, accessibility and persisted AI-prefill/visual-guidance fixtures; browser faults are injected only to test recovery; no live providers or deployed browser proof", "offline": "TypeScript build and M0 skill archive/middleware probes", "contracts": "Pinned OpenAI/Higgsfield SDKs with MOCK transports", "security": "M0 guards plus real local HTTP auth, PostgreSQL RLS, brand retries/revisions, verified email/recovery/invitations, local SMTP failures, rollback and restart recovery; actual local private S3 uploads, ClamAV validation, Temporal job isolation and worker process death recovery; plus bounded actual Docling PDF/PPTX/50-page extraction, immutable approved brand evidence, account quotas and selected-business grants; plus Crawl4AI/Chromium screenshots, private visual storage, SSRF controls and AI reservation/recovery and multimodal image provenance/budget guards with MOCK model/resource transports; plus actual isolated owner-skill planning, MOCK OpenAI create/edit, creative media/version approval, cost holds, cancellation, stale edits and replay isolation; plus real HTTP/PostgreSQL 30-slot persistence, per-channel version approvals, atomic bulk reviews, date/DST boundaries and edit/history rollback; plus actual isolated marketing-plan runtime and Temporal 30-slot generation with MOCK Responses, approved-context integrity, per-business grants, unknown-result holds and atomic promotion recovery; no external model provider or deployed generation-worker proof"}
    if name in ("browser", "security"):
        scopes[name] += "; canonical saved PNG exports use actual network-disabled Fabric/node rendering, private storage, exact-pixel/context approval and failure recovery; no social publication"
    finished_hash = source_hash()
    report = {"suite": name, "scope": scopes[name], "checked_at": now(),
              "source_sha256": finished_hash, "source_sha256_start": started_hash, "source_unchanged": started_hash == finished_hash,
              "results": results, "passed": started_hash == finished_hash and all(x["exit_code"] == 0 for x in results), "live_calls": False}
    (EVIDENCE / f"{name}.json").write_text(json.dumps(report, indent=2) + "\n")
    write_status()
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(run_suite(sys.argv[1]))
