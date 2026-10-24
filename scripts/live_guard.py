"""Fail-closed authorization for explicitly selected staging acceptance scopes."""
from decimal import Decimal, InvalidOperation
import os
import subprocess
from pathlib import Path


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
    for key in (("LIVE_TEST_ORG_IDS", "LIVE_TEST_BRAND_IDS") if env.get("LIVE_TEST_SCOPE") == "creative" else ("LIVE_TEST_ORG_IDS", "LIVE_TEST_BRAND_IDS", "LIVE_TEST_SOCIAL_ACCOUNT_IDS")):
        values = [x.strip() for x in env.get(key, "").split(",") if x.strip()]
        if not values or any(x in {"*", "all"} for x in values):
            errors.append(key + " requires explicit allowlisted IDs")
    return errors


def main():
    errors = check_live_environment(os.environ)
    if errors:
        print("\n".join(errors))
        return 2
    if os.environ.get("LIVE_TEST_SCOPE") != "creative":
        print("Full live acceptance remains NOT_IMPLEMENTED; select the guarded creative scope explicitly. No call attempted")
        return 2
    return subprocess.run(["node", "scripts/live/run-creative.mjs"], cwd=Path(__file__).resolve().parent.parent).returncode


if __name__ == "__main__":
    raise SystemExit(main())
