"""Keep the owner's 143-control matrix scoped to actual, fresh local evidence."""
import csv
from pathlib import Path

READY = {
    'SH-01': ('BusinessApp', 'GET /api/v1/businesses', 'app.brands + memberships/business_memberships', 'selected-business viewer and selector isolation'),
    'SH-02': ('NewBusiness', 'POST /api/v1/businesses', 'app.account_entitlements + brands', 'concurrent fourth-business rejection'),
    'SH-05': ('BusinessApp', 'GET /api/v1/businesses', 'authorized business context', 'exact navigation; unfinished destinations explicitly unavailable'),
    'SH-06': ('BusinessApp', 'GET /api/v1/businesses', 'authorized business context', 'Canvas route; persisted skill/image request and versioned editor, MOCK provider validation'),
    'SH-07': ('Profile', 'GET /api/auth/get-session', 'auth.user + session', 'authenticated profile read only'),
    'SH-08': ('BusinessApp', 'GET /api/v1/businesses', 'app.brands + scoped memberships', 'foreign business denial and context rekey'),
    'BR-01': ('BusinessesIndex', 'GET /api/v1/businesses', 'app.brands + brand_brain_versions', 'zero/three actual businesses; no fabricated channels/completeness'),
    'BR-02': ('NewBusiness', 'POST /api/v1/businesses', 'app.account_entitlements + brands + idempotency', 'server quota/replay/concurrency'),
    'BR-03': ('BrandOnboarding', 'GET /api/v1/businesses/:id/onboarding', 'app.business_onboarding + brand evidence', 'actual saved onboarding'),
    'ON1-02': ('NewBusiness', 'POST /api/v1/businesses', 'app.brands', 'website optional; manual/document fallback and scoped website intake'),
    'ON1-05': ('BrandOnboarding', 'GET/PATCH /api/v1/businesses/:id/onboarding', 'app.business_onboarding', 'saved steps/preferences across reload'),
    'ON2-01': ('Finding', 'PATCH /api/v1/workspaces/:org/brands/:brand/brain/findings/:id', 'app.brand_findings + audit_events', 'source-backed literal/manual/AI suggestions; actual AI quality unverified'),
    'ON2-02': ('Finding', 'PATCH /api/v1/workspaces/:org/brands/:brand/brain/findings/:id', 'app.brand_findings + audit_events', 'saved correction, stale/network errors preserve entries'),
    'ON3-02': ('BrandOnboarding', 'PATCH /api/v1/businesses/:id/onboarding', 'app.business_onboarding', 'preferences never imply OAuth connection'),
    'ON3-03': ('BrandOnboarding', 'PATCH /api/v1/businesses/:id/onboarding', 'app.business_onboarding', 'valid IANA timezone and cadence persisted; no scheduling claim'),
    'ON3-05': ('BrandOnboarding', 'POST /api/v1/workspaces/:org/brands/:brand/brain/approve', 'app.brand_brain_versions', 'immutable approved facts; first plan not generated'),
    'MM-01': ('Memory', 'GET /api/v1/workspaces/:org/brands/:brand/brain', 'app.brand_brain_versions', 'actual immutable approved profile'),
    'BL-02': ('Billing', 'GET /api/v1/accounts/current/entitlements', 'app.account_entitlements + brands', 'actual allowance only; no subscription/payment claim'),
    'PF-02': ('Profile + AuthScreen', 'POST /api/auth/request-password-reset; POST /api/auth/reset-password', 'auth tables + delivery.outbox', 'actual local email/identity recovery; external delivery unverified'),
}

CANVAS = {
    'CV-01': ('CanvasScreen', 'POST /api/v1/businesses/:id/canvas/threads/:thread/messages', 'app.canvas_messages + creative_requests + jobs', 'saved prompt, actual scoped skills/Temporal; MOCK OpenAI'),
    'CV-06': ('CanvasScreen', 'generateCreativeWorkflow / official OpenAI images.generate', 'app.creative_calls + creative_media + creative_versions', 'MOCK upstream image creation; real SDK/S3/Temporal/RLS; no live quality claim'),
    'CV-07': ('CreativeProject', 'generateCreativeWorkflow / official OpenAI images.edit', 'app.creative_versions + creative_media', 'MOCK image edit receives prior private pixels; creates new unapproved child version'),
    'CV-08': ('CreativeEditor', 'POST /api/v1/businesses/:id/creative-projects/:project/versions', 'app.creative_versions.design', 'real Fabric text layers/position/font and immutable save/reload'),
    'CV-12': ('CanvasScreen', 'GET /api/v1/businesses/:id/canvas/threads/:thread', 'app.jobs', 'actual queued/running/terminal status; unknown outcome holds generation'),
    'CV-13': ('CanvasScreen', 'POST /api/v1/businesses/:id/creative-jobs/:job/cancel', 'app.jobs.cancel_requested', 'durable local cancellation prevents promotion; no claim of remote paid-call cancellation'),
    'CV-16': ('CreativeProject', 'POST /api/v1/businesses/:id/creative-projects/:project/versions', 'app.creative_versions + creative_projects', 'versioned bounded design/caption/media IDs; stale edits denied'),
    'CV-18': ('CreativeProject', 'POST /api/v1/businesses/:id/creative-versions/:version/review', 'app.creative_reviews + creative_versions', 'exact-version review, owner/admin approval, immutable prior approval; no publication'),
    'CV-20': ('CanvasScreen', 'GET /api/v1/businesses/:id/canvas/threads/:thread', 'app.canvas_threads + canvas_messages', 'scoped persisted conversations survive reload'),
}

def update_matrix(root: Path, ready: bool, creative_ready: bool = False):
    path = root / 'docs/UI_CONTROL_MATRIX.csv'
    if not path.exists():
        return
    with path.open(newline='') as stream:
        reader=csv.DictReader(stream); fields=reader.fieldnames; rows=list(reader)
    for row in rows:
        row['status']='NOT_IMPLEMENTED'
        row['component_path']='apps/web/components/businesses.tsx (unavailable destination or unfinished control)'
        row['implementation_evidence']='Not implemented to the supplied V5 behavior. See docs/IMPLEMENTATION_STATUS.md; no live evidence.'
        if row['id'] in READY:
            component,api,db,scope=READY[row['id']]
            row.update(status='ADAPTER_READY' if ready else 'NOT_IMPLEMENTED',component_path=f'apps/web/components/businesses.tsx#{component}',api_or_worker=api,persistent_object=db,
                automated_test='tests/browser/customer.test.mjs; tests/foundation/brand-brain.test.mjs',
                implementation_evidence=f'Fresh local browser/security evidence required; {scope}. No LIVE_VERIFIED or LAUNCH_READY.')
        if row['id'] in CANVAS:
            component,api,db,scope=CANVAS[row['id']]
            component_file='creative-editor' if component=='CreativeEditor' else 'canvas'
            row.update(status='ADAPTER_READY' if creative_ready else 'NOT_IMPLEMENTED',component_path=f'apps/web/components/{component_file}.tsx#{component}',api_or_worker=api,persistent_object=db,
                automated_test='tests/browser/canvas.test.mjs; tests/foundation/creative.test.mjs; tests/contracts/creative.test.mjs',
                implementation_evidence=f'Fresh source-bound local evidence required; {scope}. No LIVE_VERIFIED or LAUNCH_READY.')
    with path.open('w',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=fields,lineterminator="\n");writer.writeheader();writer.writerows(rows)
