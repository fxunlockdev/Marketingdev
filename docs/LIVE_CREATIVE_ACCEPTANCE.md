# Capped staging creative acceptance

This operator runner exercises the **existing customer APIs** for approved Brand Brain → OpenAI planning/image creation → OpenAI image edit → editable save → human approval. It does not publish anything, alter spending grants, approve brand facts, or automate the final review. It is one part of live acceptance, not a production release certificate. Video, website/document extraction, publishing and broader deployed tenant acceptance remain separate requirements.

**Deployment prerequisite:** migration 049 and its matching generation worker must be running before enabling this runner. Roll out the worker before the API accepts the new optional `max_cost_micros` field. Existing requests without that field retain their business-grant limit. The new immutable ceiling is enforced by the worker against every reserved planning/image call across providers, including unknown outcomes. It cannot increase a business allowance. The two test requests receive half the authorized total each; pricing/reservation settings still need legitimate operator configuration.

## Prepare once

- Use a dedicated staging business with an already reviewed, approved Brand Brain and an active OpenAI creative allowance. Add legitimate provider credentials and activate the worker through the existing setup workflow.
- Supply two verified staging logins: the business owner/reviewer and an unrelated account with no access to that business. The runner refuses missing isolation. Test logins must be usable by the password API; an incomplete MFA challenge is rejected.
- Put `email`, `password`, `foreignEmail`, and `foreignPassword` in a JSON file outside the repository. Restrict it to the current user (`chmod 600`). Do not paste credentials into a chat, command argument, report or source file.
- Choose an absolute journal path in a private directory. Keep this journal for every resume of this run. A new journal constitutes a new test and must have a new explicit spending authorization.

## Explicit opt-in

Set these environment variables only when ready to perform paid tests:

```text
APP_MODE=staging
LIVE_SMOKE_ENABLED=true
LIVE_SMOKE_ACK=I_AUTHORIZE_CAPPED_STAGING_TESTS
LIVE_TEST_SCOPE=creative
LIVE_TEST_ORIGIN=https://desvio-dev-web-dev.up.railway.app
LIVE_TEST_ORG_IDS=<one exact organization UUID>
LIVE_TEST_BRAND_IDS=<one exact business UUID>
LIVE_TEST_MEDIA_ORIGINS=<exact HTTPS origin serving private signed media>
PROVIDER_BUDGET_USD=<authorized total, at most six decimal places>
LIVE_TEST_CREDENTIALS_FILE=<absolute private credentials JSON path>
LIVE_TEST_JOURNAL=<absolute private journal path>
```

Run `make verify-live`. No social-account allowlist is required for the **creative** scope because it never posts or connects accounts. Other scopes are currently rejected rather than silently treated as creative acceptance.

The runner submits at most one create and one edit job, uses fixed replay keys, reads the private PNG outputs, checks another account cannot read the business/project/media, and saves a distinct editable caption version. It then exits with code **3** and `awaiting_human_approval`. Open that business’s Canvas and select the conversation named `Staging acceptance <run ID>`. Inspect the image and caption and approve that exact saved version. Rerun with **the same journal and unchanged settings** to verify approval without creating additional paid jobs.

Exit **0** means this bounded creative journey passed. Exit **2** means a failed prerequisite, failed/uncertain job, expired wait, changed scope, or other check failure. Inspect the saved journal and the platform before resuming. Unknown provider outcomes are never retried as a new job. A lost API response can only replay the original request key. The journal contains IDs and synthetic requests, not login credentials or signed media URLs. Evidence is saved beside it with private file permissions; it does not automatically set integration statuses or unlock the full release gate.

A lock prevents simultaneous use of one journal. Normal exit releases it. After a process crash, inspect the PID in `<journal>.lock/owner.json` and confirm that runner has ended before removing that exact lock directory. Never remove a lock while its runner may still be active. A resumed run rejects changed business, budget, media origins, approved Brand Brain, or login identities.
