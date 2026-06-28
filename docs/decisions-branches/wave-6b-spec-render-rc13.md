← back to [docs/timeline.md](../timeline.md)

## 2026-06-28 18:52 - rc.13 — render SPEC §6.8.1/§6.10.1 markers + pin the hook's clud-bug version

**Reasoning:** SPEC conformance (drift the pre-launch audit caught): renderMultiPassMarkdown now emits the NORMATIVE per-finding '<!-- pass: <id> -->' (§6.8.1, originating pass lowercased) and '<!-- consensus: 1-of-N|2-of-2|arbitrated -->' (§6.10.1, when gated) markers immediately before each bullet — the auditable/dashboard-parseable contract. The auto-fix gate (§6.10.2) already read finding.consensus directly; only the rendered marker was missing. AND: init --with-hooks now pins 'npx clud-bug@<version> review-prompt' so the commit hook never resolves to a 'latest' dist-tag (0.6.34) that predates the review-prompt verb; clud-bug update refreshes the pin in place (marker-gated).

**Alternatives considered:** Amend §6.8.1 to bless the inline [Pass N] bracket format instead of adding HTML markers — rejected: the markers are the machine contract; keep both (human brackets + machine markers). Pin via @next (moving target) — rejected for the deterministic scaffolding-version pin.

**Implications:**
- rc.13 publish is a USER ACTION (npm publish --tag next). Adversarial review clean. Closes the §6.10.1 render gap flagged in PR 0b + the npx->latest gap. The clud-bug dogfood install uses the LOCAL bin (not npx), so it's independent of this publish. 843 tests green.

---

