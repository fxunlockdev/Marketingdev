"""Fail-closed opt-in check. M0 has no live provider runner."""
from decimal import Decimal, InvalidOperation
import os


def check_live_environment(env):
    errors = []
    if env.get("APP_MODE") != "staging":
        errors.append("APP_MODE must be staging")
    if env.get("LIVE_SMOKE_ENABLED") != "true" or env.get("LIVE_SMOKE_ACK") != "I_AUTHORIZE_CAPPED_STAGING_TESTS":
        errors.append("Explicit staging live-test acknowledgment required")
    try:
        cap = Decimal(env.get("PROVIDER_BUDGET_USD", "0"))
        if not cap.is_finite() or cap <= 0:
            raise InvalidOperation
    except InvalidOperation:
        errors.append("A finite positive provider budget is required")
    for key in ("LIVE_TEST_ORG_IDS", "LIVE_TEST_BRAND_IDS", "LIVE_TEST_SOCIAL_ACCOUNT_IDS"):
        values = [x.strip() for x in env.get(key, "").split(",") if x.strip()]
        if not values or any(x in {"*", "all"} for x in values):
            errors.append(key + " requires explicit allowlisted IDs")
    return errors


def main():
    errors = check_live_environment(os.environ)
    # Authorization is necessary, not sufficient: no callable live harness yet.
    errors.append("Live provider workflow is NOT_IMPLEMENTED at M0; no network call attempted")
    print("\n".join(errors))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
