"""M0 gate always blocks launch. Future promotions require a trusted live runner."""
from datetime import datetime, timezone, timedelta
import json
import sys
from jsonschema import Draft202012Validator, FormatChecker

from scripts.skill_audit import ROOT
from scripts.verify import source_hash


def gate_errors(status):
    schema = json.loads((ROOT / "contracts/integration-status.schema.json").read_text())
    errors = [e.message for e in Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(status)]
    if errors:
        return errors
    checked = datetime.fromisoformat(status["checked_at"].replace("Z", "+00:00"))
    if checked.tzinfo is None or not timedelta(0) <= datetime.now(timezone.utc) - checked <= timedelta(hours=24):
        errors.append("Evidence stale or future dated")
    for name in ["offline", "contracts", "security"]:
        path = ROOT / f"docs/evidence/{name}.json"
        if not path.exists():
            errors.append(f"Missing {name} evidence")
            continue
        report = json.loads(path.read_text())
        if report.get("passed") is not True or report.get("source_sha256") != source_hash():
            errors.append(f"Failed or stale {name} evidence")
    # No manual LAUNCH_READY flags can bypass this missing live execution proof.
    errors.append("M0: product E2E, authenticated tenant/RLS and trusted live evidence runner are NOT_IMPLEMENTED")
    if status["overall_release_state"] != "LAUNCH_READY":
        errors.append("Overall release state is BLOCKED")
    return errors


def main():
    try:
        status = json.loads((ROOT / "docs/evidence/integration-status.json").read_text())
        errors = gate_errors(status)
    except (OSError, ValueError, KeyError) as exc:
        errors = [f"Invalid or missing evidence: {type(exc).__name__}"]
    report = {"passed": not errors, "errors": errors}
    (ROOT / "docs/evidence/release-gate.json").write_text(json.dumps(report, indent=2) + "\n")
    print("\n".join(errors))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
