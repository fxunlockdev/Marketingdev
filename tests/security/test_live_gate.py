import unittest
from scripts.live_guard import check_live_environment
from scripts.release_gate import gate_errors
from scripts.verify import write_status


class GateTests(unittest.TestCase):
    def test_default_denies_live_operations(self):
        self.assertTrue(check_live_environment({}))

    def test_nan_and_wildcard_budget_allowlists_rejected(self):
        env = {"APP_MODE":"staging", "LIVE_SMOKE_ENABLED":"true", "LIVE_SMOKE_ACK":"I_AUTHORIZE_CAPPED_STAGING_TESTS", "PROVIDER_BUDGET_USD":"NaN", "LIVE_TEST_ORG_IDS":"*", "LIVE_TEST_BRAND_IDS":"b", "LIVE_TEST_SOCIAL_ACCOUNT_IDS":"s"}
        self.assertEqual(len(check_live_environment(env)), 2)

    def test_manual_green_flags_cannot_unlock_launch(self):
        status = write_status()
        status["overall_release_state"] = "LAUNCH_READY"
        for row in status["integrations"].values():
            row.update(state="LAUNCH_READY", live_test=True, blocked_reason=None)
        self.assertTrue(any("NOT_IMPLEMENTED" in e for e in gate_errors(status)))


if __name__ == "__main__":
    unittest.main()
