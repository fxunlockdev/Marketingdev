.PHONY: bootstrap audit-skills verify-offline verify-browser verify-contracts verify-security verify-live release-gate dev verify-load verify-social verify-connections verify-publishing verify-publishing-ui verify-deployment bootstrap-database verify-video-provider verify-video-runtime verify-video-storage
PYTHON ?= uv run --frozen python

.PHONY: verify-document-visuals
verify-document-visuals:
	$(PYTHON) -m scripts.verify document-visuals

bootstrap:
	npm ci --ignore-scripts
	uv sync --frozen

audit-skills:
	$(PYTHON) -m scripts.skill_audit

verify-offline:
	$(PYTHON) -m scripts.verify offline

verify-browser:
	$(PYTHON) -m scripts.verify browser

verify-contracts:
	$(PYTHON) -m scripts.verify contracts

verify-security:
	$(PYTHON) -m scripts.verify security

verify-live:
	$(PYTHON) -m scripts.live_guard

release-gate:
	$(PYTHON) -m scripts.release_gate

dev verify-load:
	@echo 'NOT_IMPLEMENTED: full-stack dev/load harness and production provisioning remain pending. Local API foundation tests: npm run test:foundation.'
	@exit 2

verify-social:
	$(PYTHON) -m scripts.verify social

verify-connections:
	$(PYTHON) -m scripts.verify connections

verify-publishing:
	$(PYTHON) -m scripts.verify publishing

verify-publishing-ui:
	$(PYTHON) -m scripts.verify publishing-ui

verify-deployment:
	$(PYTHON) -m scripts.verify deployment

bootstrap-database:
	node scripts/bootstrap-database.mjs

verify-video-provider:
	$(PYTHON) -m scripts.verify video-provider

verify-video-runtime:
	$(PYTHON) -m scripts.verify video-runtime

verify-video-storage:
	$(PYTHON) -m scripts.verify video-storage
