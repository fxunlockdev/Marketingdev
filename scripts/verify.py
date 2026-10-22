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
    "document-visuals": [["npm", "run", "build"], ["node", "scripts/document-visual-test.mjs"], ["node", "scripts/foundation-test.mjs", "--documents"]],
    "video-canvas": [["npm", "run", "build"], ["node", "scripts/foundation-test.mjs", "--exports"], ["node", "scripts/foundation-test.mjs", "--canvas-web"]],
    "video-storage": [["npm", "run", "build"], ["node", "scripts/foundation-test.mjs", "--video-storage"]],
    "video-runtime": [["npm", "run", "build"], ["node", "--test", "tests/runtime/video-skills.test.mjs"], ["node", "scripts/video-media-test.mjs"]],
    "video-provider": [["npm", "run", "build"], ["node", "scripts/foundation-test.mjs", "--video-provider"]],
    "deployment": [["npm", "run", "build"], ["node", "scripts/deployment-test.mjs"], ["node", "scripts/foundation-test.mjs", "--accounts"]],
    "publishing-ui": [["npm", "run", "build"], ["node", "scripts/foundation-test.mjs", "--publishing-web"]],
    "publishing": [["npm", "run", "build"], ["node", "scripts/foundation-test.mjs", "--publishing"]],
    "connections": [["npm", "run", "build"], ["node", "scripts/foundation-test.mjs", "--social-web"]],
    "social": [["npm", "run", "build"], ["node", "--test", "tests/contracts/postiz.test.mjs", "tests/contracts/provisioning.test.mjs"], ["node", "scripts/foundation-test.mjs", "--social"]],
    "offline": [["npm", "run", "build"], [sys.executable, "-m", "unittest", "discover", "-s", "tests/offline", "-v"]],
    "browser": [["npm", "run", "build"], ["npm", "run", "test:browser"]],
    "contracts": [["npm", "run", "build"], ["node", "--test", "tests/contracts/sdk.test.mjs", "tests/contracts/intake.test.mjs", "tests/contracts/creative.test.mjs", "tests/contracts/planning.test.mjs", "tests/contracts/local-calendar.test.mjs", "tests/contracts/postiz.test.mjs", "tests/contracts/provisioning.test.mjs", "tests/contracts/higgsfield.test.mjs", "tests/contracts/video-download.test.mjs", "tests/contracts/video-planning.test.mjs"]],
    "security": [["npm", "run", "build"], ["npm", "audit", "--prefix", "apps/media", "--omit=dev", "--audit-level=moderate", "--json"], ["npm", "run", "test:foundation"], [sys.executable, "-m", "unittest", "discover", "-s", "tests/security", "-v"]],
}


def now():
    return datetime.now(timezone.utc).isoformat()


def source_hash():
    files = {}
    for directory in ["scripts", "tests", "contracts", "apps", "database", "infra"]:
        for path in sorted((ROOT / directory).rglob("*")):
            if path.is_file() and not set(path.parts).intersection({"__pycache__", ".next", "node_modules", ".venv"}) and not path.name.endswith(".tsbuildinfo"):
                files[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
    for name in ["package.json", "package-lock.json", "pyproject.toml", "uv.lock", "Makefile", "tsconfig.json", ".dockerignore"]:
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
            "blocked_reason": "Real local Docling/native rendering/English textless-page OCR, private page storage, Temporal/RLS, approved document visual provenance and account quota tests. The model sees actual page pixels through the official adapter with explicitly MOCK responses. Mixed-content OCR, broader document fidelity, full business roles, deployed sandbox and live model quality/provider journeys remain incomplete."}
    integrations["v5_business_ui"] = {"state": "ADAPTER_READY" if foundation_passed and browser_passed else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/security.json", "docs/evidence/browser.json"],
        "blocked_reason": "Business navigation, scoped records, source review and saved goals/prefill fixtures are tested locally. Actual AI output quality, strategy/plan and creative/social workflows remain incomplete; unavailable controls are labeled honestly."}
    for capability in ["crawl4ai", "website_visual_evidence", "ai_brand_onboarding"]:
        integrations[capability] = {"state": "ADAPTER_READY" if foundation_passed and browser_passed else "NOT_IMPLEMENTED", "live_test": False,
            "evidence": ["docs/evidence/security.json", "docs/evidence/contracts.json", "docs/evidence/browser.json"],
            "blocked_reason": "Local real Crawl4AI/Chromium/private storage and RLS tests, MOCK website resources/model responses, saved AI prefill/visual-guidance browser fixtures and multimodal SDK image/citation/budget contracts. Real public rendered HTTP smoke is separately scoped. Deployed broker, actual visual-model quality, paid model evidence and full end-to-end product remain incomplete."}
    contracts_path = EVIDENCE / "contracts.json"
    contracts = json.loads(contracts_path.read_text()) if contracts_path.exists() else {}
    video_contracts_ready = contracts.get("passed") is True and contracts.get("source_sha256") == source_hash()
    integrations["higgsfield_transport"] = {"state": "ADAPTER_READY" if video_contracts_ready else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/contracts.json"],
        "blocked_reason": "Pinned SDK and documented image-to-video/edit bodies, fixed-origin HTTP submission/status/cancel, persisted-intent fingerprint boundary, duplicate key semantics and bounded credentials-free output download tested against MOCK transports. Downloaded bytes remain untrusted. The durable provider substage has separate evidence; complete approved-reference/skill-driven video workflow, media decoder/private canonical output, Canvas video controls, account model eligibility, actual provider output and paid/live verification remain incomplete."}
    canvas_path = EVIDENCE / "video-canvas.json"
    canvas_video = json.loads(canvas_path.read_text()) if canvas_path.exists() else {}
    canvas_video_ready = canvas_video.get("passed") is True and canvas_video.get("source_sha256") == source_hash()
    integrations["canvas_video_workflow"] = {"state": "ADAPTER_READY" if canvas_video_ready else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/video-canvas.json"],
        "blocked_reason": "Local authenticated video script/prompt edit and explicit pre-generation approval, actual original skills/Temporal/rendering/private storage, final review and retained regeneration versions with MOCK paid providers. Deployment, live generation/quality, Gemini, calendar video attachment/publishing and recurring planning remain incomplete. This is not full Canvas or product completion."}
    video_path = EVIDENCE / "video-provider.json"
    video = json.loads(video_path.read_text()) if video_path.exists() else {}
    video_ready = video_contracts_ready and video.get("passed") is True and video.get("source_sha256") == source_hash()
    integrations["video_provider_stage"] = {"state": "ADAPTER_READY" if video_ready else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/video-provider.json", "docs/evidence/contracts.json"],
        "blocked_reason": "Real disposable PostgreSQL forced RLS, encrypted immutable intents, per-business funded-grant fixtures/reservations, MOCK Higgsfield submit/status/cancel, unknown-write holds and durable Temporal timer/worker replacement. This is an internal pipeline stage without a customer route or ordinary worker registration. Original video skill, approved reference leases/lineage, media validation/private versions, Canvas controls, deployed runtime and paid/live acceptance remain incomplete. Provider completion does not mark a Desvio job succeeded."}
    storage_path = EVIDENCE / "video-storage.json"
    storage = json.loads(storage_path.read_text()) if storage_path.exists() else {}
    storage_ready = storage.get("passed") is True and storage.get("source_sha256") == source_hash()
    integrations["canonical_video_object_storage"] = {"state": "ADAPTER_READY" if storage_ready else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/video-storage.json"],
        "blocked_reason": "Real local private S3-compatible storage verifies bounded 64 MiB canonical MP4 byte persistence, replay/concurrency/lost acknowledgements and a fault-injected conditional-write race; existing authenticated upload/scanner/tenant/Temporal worker-recovery regression is included. Synthetic byte fixtures are not decoded videos or provider output. Customer uploads retain 20 MiB limits. Video database/version persistence, approved-reference leases, parent jobs, deployed storage and live generation remain incomplete."}
    runtime_path = EVIDENCE / "video-runtime.json"
    runtime = json.loads(runtime_path.read_text()) if runtime_path.exists() else {}
    runtime_ready = video_contracts_ready and runtime.get("passed") is True and runtime.get("source_sha256") == source_hash()
    integrations["video_planning_media_stage"] = {"state": "ADAPTER_READY" if runtime_ready else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/video-runtime.json", "docs/evidence/contracts.json"],
        "blocked_reason": "Actual isolated original video/ad-creative/product-marketing/social skill planning with MOCK model; bounded brief/fact/timing contracts. Actual ARM64 FFmpeg is packaged into an exact image from verified Debian archives and called through the Node adapter without runtime/dependency bind mounts. Synthetic MP4 decoding, normalization, timed caption/CTA overlays, output validation and replay are tested. This is not a cloud/AMD64-deployed runtime, private saved customer video, parent workflow, customer feature, provider output quality or live acceptance."}
    integrations["higgsfield_video"]["blocked_reason"] = "Transport, untrusted download and durable provider substage have separate local test scope. Connecting the separately tested skill/media components into the full tenant generation/edit workflow, approved reference leases, baked media image and overlay composition, private versions/approval, customer UI and cost-capped live acceptance remain incomplete. No video customer route is enabled."
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
    social_path = EVIDENCE / "social.json"
    social = json.loads(social_path.read_text()) if social_path.exists() else {}
    social_ready = social.get("passed") is True and social.get("source_sha256") == source_hash()
    integrations["postiz_connection_boundary"] = {"state": "ADAPTER_READY" if social_ready else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/social.json"],
        "blocked_reason": "Pinned-source transport contracts use a MOCK Postiz HTTP server. Actual local auth/PostgreSQL RLS/Temporal prove encrypted per-business binding, queued account refresh, permission/rotation/cancel boundaries and snapshot recovery. No real Postiz organization/OAuth/token health or publishing acceptance. Session-bound callback workflows are also tested locally. Provisioning and customer UI have separate focused local evidence; authorized live tests remain incomplete."}
    integrations["social_oauth_workflow"] = {"state": "ADAPTER_READY" if social_ready else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/social.json"],
        "blocked_reason": "Actual local auth sessions, forced PostgreSQL RLS and Temporal prove LinkedIn start/callback with 256-bit state, encrypted code, expiry, single-session ownership, one-time exchange, revoked access and uncertain-outcome recovery. Upstream HTTP is explicitly MOCK. No real provider login/consent or deployed callback UI has been tested. Customer UI has separate focused evidence; account selection/reconnect/revoke and live acceptance remain incomplete."}
    integrations["social_account_provisioning"] = {"state": "ADAPTER_READY" if social_ready else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/social.json"],
        "blocked_reason": "Actual local auth/RLS/Temporal and separate provisioning role prove idempotent setup enqueue, encrypted candidate capture, remote identity/name verification, retryable read-only confirmation, binding recovery and cross-business denial. Enterprise Postiz HTTP is MOCK. No real provisioning/deployment proof. Customer UI has separate focused evidence. Operator resolution of unknown/lost responses, credential lifecycle and live acceptance remain incomplete."}
    connections_path = EVIDENCE / "connections.json"
    connections = json.loads(connections_path.read_text()) if connections_path.exists() else {}
    connections_ready = social_ready and connections.get("passed") is True and connections.get("source_sha256") == source_hash()
    integrations["customer_connections_ui"] = {"state": "ADAPTER_READY" if connections_ready else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/social.json", "docs/evidence/connections.json"],
        "blocked_reason": "Actual local browser/session/business setup, server callback, private provisioning worker, PostgreSQL RLS and Temporal tested with explicitly MOCK Postiz HTTP and LinkedIn consent. Desktop/mobile accessibility, canceled/expired/wrong-login returns, saved account refresh and business isolation are covered. No real provider consent, deployed ingress, token health, publication or full lifecycle acceptance. Operator recovery, reconnect/revoke and other channels remain incomplete."}
    publishing_path = EVIDENCE / "publishing.json"
    publishing = json.loads(publishing_path.read_text()) if publishing_path.exists() else {}
    publishing_ready = social_ready and publishing.get("passed") is True and publishing.get("source_sha256") == source_hash()
    integrations["postiz_publish"] = {"state": "ADAPTER_READY" if publishing_ready else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/social.json", "docs/evidence/publishing.json"],
        "blocked_reason": "Actual local session/RLS, exact approved Fabric-rendered PNG/private S3, dispatcher and Temporal publication/reconciliation use an explicitly MOCK Postiz HTTP server. Explicit destination consent, expiring staging allowlists, immutable snapshots/history and unknown-write holds tested. No actual social publication, deployed/runtime equivalence or launch proof. Customer publishing UI has separate focused evidence. Remote cancellation/rescheduling, operator recovery, other channels/formats, analytics and live acceptance remain incomplete."}
    publishing_ui_path = EVIDENCE / "publishing-ui.json"
    publishing_ui = json.loads(publishing_ui_path.read_text()) if publishing_ui_path.exists() else {}
    publishing_ui_ready = publishing_ready and publishing_ui.get("passed") is True and publishing_ui.get("source_sha256") == source_hash()
    for capability in ["customer_publishing_ui", "business_overview"]:
        integrations[capability] = {"state": "ADAPTER_READY" if publishing_ui_ready else "NOT_IMPLEMENTED", "live_test": False,
            "evidence": ["docs/evidence/social.json", "docs/evidence/publishing.json", "docs/evidence/publishing-ui.json"],
            "blocked_reason": "Actual local Next/Nest/session/RLS/private canonical PNG/Temporal browser journeys verify exact image/destination/time consent, persisted status/history, cancellation before submission, ambiguous-response holds, business isolation, real overview counts and desktop/mobile accessibility. Postiz HTTP is explicitly MOCK. No genuine social publication, deployed UI/ingress, analytics/usage recommendations or full launch acceptance. Focused evidence does not replace full browser/security gates."}
    deployment_path = EVIDENCE / "deployment.json"
    deployment = json.loads(deployment_path.read_text()) if deployment_path.exists() else {}
    deployment_ready = deployment.get("passed") is True and deployment.get("source_sha256") == source_hash()
    integrations["deployment_bootstrap"] = {"state": "ADAPTER_READY" if deployment_ready else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/deployment.json"],
        "blocked_reason": "Actual disposable PostgreSQL role/migration bootstrap, rollback/replay/credential-drift rejection, cloud-address API startup and real generated standalone Next/browser/proxy/shutdown smoke tested on the host. Pinned Node registry manifests and Dockerfiles are prepared, not container-build/deployed proof. Railway dev creation, Linux image acceptance, private sandbox workers, operator setup, cloud security and live providers remain incomplete."}
    integrations["creative_reference_selection"] = {"state": "ADAPTER_READY" if creative_ready else "NOT_IMPLEMENTED", "live_test": False,
        "evidence": ["docs/evidence/security.json", "docs/evidence/browser.json", "docs/evidence/contracts.json"],
        "blocked_reason": "Local business-scoped source-image approval, private previews, up to three selected references, real skill/Temporal generation and ordered multipart image bytes through the official SDK with MOCK OpenAI responses. Immutable source links, saved input hashes, replay, revoked-approval rejection and pre-call corruption checks are covered. Whole captured pages only; uploaded product-image selection/cropping, broader creative formats, deployed workers and real provider fidelity/cost acceptance remain incomplete."}
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
    scopes = {"browser": "Actual Chromium through V5 business UI and Canvas to real local HTTP/PostgreSQL/SMTP/S3/ClamAV/Temporal; actual isolated owner skills, MOCK OpenAI generation/edit, Fabric edits/export, version approval and uncertain-outcome holds; calendar planning, linked creative generation/revision, feedback and bulk channel review with MOCK providers; manual onboarding/approved memory, scope, quota, recovery, accessibility and persisted AI-prefill/visual-guidance fixtures; browser faults are injected only to test recovery; no live providers or deployed browser proof", "offline": "TypeScript build and M0 skill archive/middleware probes", "contracts": "Pinned SDK and documented provider contracts with MOCK transports; bounded Higgsfield image-to-video/edit/status/cancel/idempotency and untrusted output download, including actual SafeWeb private-DNS denial; no live video or durable video product workflow", "security": "M0 guards plus real local HTTP auth, PostgreSQL RLS, brand retries/revisions, verified email/recovery/invitations, local SMTP failures, rollback and restart recovery; actual local private S3 uploads, ClamAV validation, Temporal job isolation and worker process death recovery; plus bounded actual Docling PDF/PPTX/50-page extraction, immutable approved brand evidence, account quotas and selected-business grants; plus Crawl4AI/Chromium screenshots, private visual storage, SSRF controls and AI reservation/recovery and multimodal image provenance/budget guards with MOCK model/resource transports; plus actual isolated owner-skill planning, MOCK OpenAI create/edit, creative media/version approval, cost holds, cancellation, stale edits and replay isolation; plus real HTTP/PostgreSQL 30-slot persistence, per-channel version approvals, atomic bulk reviews, date/DST boundaries and edit/history rollback; plus actual isolated marketing-plan runtime and Temporal 30-slot generation with MOCK Responses, approved-context integrity, per-business grants, unknown-result holds and atomic promotion recovery; no external model provider or deployed generation-worker proof"}
    if name in ("browser", "security"):
        scopes[name] += "; canonical saved PNG exports use actual network-disabled Fabric/node rendering, private storage, exact-pixel/context approval and failure recovery; no social publication"
    scopes["social"] = "Real local authentication, PostgreSQL forced RLS, encrypted per-business credentials and Temporal connection-refresh jobs; audited Postiz HTTP contracts against an explicitly MOCK local server; session-bound authorization/callback jobs with MOCK Postiz; no social OAuth or publication to an external provider"
    scopes["document-visuals"] = "Actual pinned PDFium, LibreOffice and English Tesseract in a baked network-disabled, read-only, non-root container. Synthetic real PDF/PPTX rendering, scanned text OCR, hidden slide/image composition and malformed/external-resource denial. Real local authenticated upload, malware scan, private S3, Temporal extraction, PostgreSQL/RLS, source-backed Correct/Wrong/Edit and approved memory, including an image-only PDF. Private document page storage, scoped signed preview, bounded actual JPEG inputs to the official model adapter with explicitly MOCK responses, exact page/source provenance, reviewed visual directions and approved memory are connected. OCR fallback covers pages without native text; mixed-page OCR, broader languages, complete visual coverage beyond the existing model budget, deployed/runtime and live model quality remain incomplete."
    scopes["connections"] = "Actual Next/Nest/Better Auth/PostgreSQL/Temporal/private provisioning worker browser journey; explicitly MOCK Postiz HTTP and LinkedIn consent; no external OAuth, paid models, deployment or publishing. Focused suite does not replace full browser/security gates."
    scopes["publishing"] = "Actual local auth, forced PostgreSQL RLS, approved creative fixtures, network-disabled canonical Fabric rendering/private S3, dispatcher and Temporal; explicitly MOCK Postiz upload/schedule/status HTTP. No actual OAuth/social publication or deployed/live acceptance; focused backend suite does not replace full security/browser gates."
    scopes["publishing-ui"] = "Actual Next/Nest/Better Auth/PostgreSQL RLS/private S3/canonical Fabric renderer/Temporal browser journeys; exact approved fixture image and destination/time consent, published/uncertain/missing observations, history, cancellation and lost-client-response recovery, stale approval/preview integrity, readonly/foreign/business switching, genuine overview counts and desktop/mobile accessibility. Explicitly MOCK Postiz HTTP; no real social post or live/deployed evidence. Focused suite does not replace full security/browser gates."
    scopes["deployment"] = "Actual disposable PostgreSQL bootstrap and six distinct service logins; unrelated database/role refusal, transaction rollback, checksum/privilege/password drift, concurrent replay, API dual-stack startup and shutdown; generated standalone Next package serving real API proxy and browser sign-in; configuration mismatch rejection. Existing real account/tenant/email integration regression also runs through the refactored migration wrapper. Host-built artifact only: no Linux container build, Railway deployment, external SMTP, paid providers or social publication."
    scopes["video-canvas"] = "Actual authenticated app, forced PostgreSQL RLS, approved image binding, original skills, editable video prompt approval before any MOCK Higgsfield submission, private lease cleanup, actual media renderer/private clips/posters, final review, retained regeneration history and cancellation. Actual Next browser and Temporal dispatcher/worker cover draft editing/reload, approval, video playback and final approval alongside image/calendar regression. Paid upstreams are MOCK; Video versions also flow from Canvas to day-by-day calendar and exact-version review with channel/type checks, cross-business denial, immutable history and approval reset on replacement. Paid upstreams are MOCK; deployed/live, Gemini, mixed AI planning, video publishing and recurring planning remain open."
    scopes["video-provider"] = "Actual disposable PostgreSQL migrations/forced RLS, separate runtime roles, immutable encrypted provider intents, business-scoped grant fixtures and budget reservation races, MOCK Higgsfield create/edit/status/cancel HTTP, failed commits/unknown-write holds, cancellation/access loss, private-state tampering and real Temporal durable timer/worker replacement. Internal provider stage only; no customer video route, original video skill, approved reference lineage, decoded/private output, complete Canvas workflow, cloud deployment or paid/live provider evidence."
    scopes["video-runtime"] = "Real network-disabled Deep Agents runtime loading exact original video/ad-creative/product-marketing/social skills with MOCK model responses, reference/context isolation, denied helper/tools, bounded broker and image/30-day-plan regression. Actual pinned ARM64 FFmpeg image built offline from verified Debian archives, without runtime/dependency bind mounts; synthetic MP4 complete decode/re-encode, timed literal caption/CTA composition with real-frame checks, poster, metadata removal, duration/codec/format/size/rotation/color/stream rejection and sanitized stdio protocol. Node adapter runs the exact credential-free/non-root/read-only/network-disabled image, validates returned bytes and provenance, and checks repeat rendering. No complete parent job/private version, Canvas video UI, cloud/AMD64 deployment, paid provider output or live acceptance."
    scopes["video-storage"] = "Actual local private S3-compatible storage with synthetic byte fixtures through 64 MiB; concurrency, replay/new-client recovery, lost acknowledgement after real write, injected 404/412 race with real saved bytes, corruption/size denial and unchanged 20 MiB upload boundary. Existing real authenticated API/forced PostgreSQL RLS/ClamAV/private storage/Temporal worker-process death and cancellation tests also run. Not actual provider media, decoded video, database video versions, parent generation workflow, deployed storage or live acceptance."
    finished_hash = source_hash()
    scopes["browser"] += "; explicit document-reference approval/preview/removal and website-reference selection through an actual Canvas job to MOCK multipart OpenAI edits"
    scopes["security"] += "; business-scoped creative reference approval and revocation, immutable image linkage, bounded transformed bytes, saved provenance, conservative per-reference reservation, replay and corrupted-source rejection before model planning"
    report = {"suite": name, "scope": scopes[name], "checked_at": now(),
              "source_sha256": finished_hash, "source_sha256_start": started_hash, "source_unchanged": started_hash == finished_hash,
              "results": results, "passed": started_hash == finished_hash and all(x["exit_code"] == 0 for x in results), "live_calls": False}
    (EVIDENCE / f"{name}.json").write_text(json.dumps(report, indent=2) + "\n")
    write_status()
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(run_suite(sys.argv[1]))
