"""Keep the owner's 143-control matrix scoped to actual, fresh local evidence."""
import csv
from pathlib import Path

READY = {
    'SH-01': ('BusinessApp', 'GET /api/v1/businesses', 'app.brands + memberships/business_memberships', 'selected-business viewer and selector isolation'),
    'SH-02': ('NewBusiness', 'POST /api/v1/businesses', 'app.account_entitlements + brands', 'concurrent fourth-business rejection'),
    'SH-05': ('BusinessApp', 'GET /api/v1/businesses', 'authorized business context', 'exact navigation; unfinished destinations explicitly unavailable'),
    'SH-06': ('BusinessApp', 'GET /api/v1/businesses', 'authorized business context', 'Canvas route only; generation NOT_IMPLEMENTED'),
    'SH-07': ('Profile', 'GET /api/auth/get-session', 'auth.user + session', 'authenticated profile read only'),
    'SH-08': ('BusinessApp', 'GET /api/v1/businesses', 'app.brands + scoped memberships', 'foreign business denial and context rekey'),
    'BR-01': ('BusinessesIndex', 'GET /api/v1/businesses', 'app.brands + brand_brain_versions', 'zero/three actual businesses; no fabricated channels/completeness'),
    'BR-02': ('NewBusiness', 'POST /api/v1/businesses', 'app.account_entitlements + brands + idempotency', 'server quota/replay/concurrency'),
    'BR-03': ('BrandOnboarding', 'GET /api/v1/businesses/:id/onboarding', 'app.business_onboarding + brand evidence', 'actual saved onboarding'),
    'ON1-02': ('NewBusiness', 'POST /api/v1/businesses', 'app.brands', 'website optional; manual/document fallback, crawling unavailable'),
    'ON1-05': ('BrandOnboarding', 'GET/PATCH /api/v1/businesses/:id/onboarding', 'app.business_onboarding', 'saved steps/preferences across reload'),
    'ON2-01': ('Finding', 'PATCH /api/v1/workspaces/:org/brands/:brand/brain/findings/:id', 'app.brand_findings + audit_events', 'literal/manual facts only; semantic inference unfinished'),
    'ON2-02': ('Finding', 'PATCH /api/v1/workspaces/:org/brands/:brand/brain/findings/:id', 'app.brand_findings + audit_events', 'saved correction, stale/network errors preserve entries'),
    'ON3-02': ('BrandOnboarding', 'PATCH /api/v1/businesses/:id/onboarding', 'app.business_onboarding', 'preferences never imply OAuth connection'),
    'ON3-03': ('BrandOnboarding', 'PATCH /api/v1/businesses/:id/onboarding', 'app.business_onboarding', 'valid IANA timezone and cadence persisted; no scheduling claim'),
    'ON3-05': ('BrandOnboarding', 'POST /api/v1/workspaces/:org/brands/:brand/brain/approve', 'app.brand_brain_versions', 'immutable approved facts; first plan not generated'),
    'MM-01': ('Memory', 'GET /api/v1/workspaces/:org/brands/:brand/brain', 'app.brand_brain_versions', 'actual immutable approved profile'),
    'BL-02': ('Billing', 'GET /api/v1/accounts/current/entitlements', 'app.account_entitlements + brands', 'actual allowance only; no subscription/payment claim'),
    'PF-02': ('Profile + AuthScreen', 'POST /api/auth/request-password-reset; POST /api/auth/reset-password', 'auth tables + delivery.outbox', 'actual local email/identity recovery; external delivery unverified'),
}

def update_matrix(root: Path, ready: bool):
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
    with path.open('w',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader();writer.writerows(rows)
