.PHONY: bootstrap audit-skills verify-offline verify-contracts verify-security verify-live release-gate dev verify-load
PYTHON ?= uv run --frozen python

bootstrap:
	npm ci --ignore-scripts
	uv sync --frozen

audit-skills:
	$(PYTHON) -m scripts.skill_audit

verify-offline:
	$(PYTHON) -m scripts.verify offline

verify-contracts:
	$(PYTHON) -m scripts.verify contracts

verify-security:
	$(PYTHON) -m scripts.verify security

verify-live:
	$(PYTHON) -m scripts.live_guard

release-gate:
	$(PYTHON) -m scripts.release_gate

dev verify-load:
	@echo 'NOT_IMPLEMENTED at M0: application runtime/load harness is the next milestone.'
	@exit 2
