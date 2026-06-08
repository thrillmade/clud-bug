← back to [docs/timeline.md](../timeline.md)

## 2026-06-08 15:14 - v0.6.35: never block on large diffs — MAX_DIFF_BYTES 80K → 5MB

**Reasoning:** PR #29 incident in clud-bug-app: 108KB diff silently truncated at 80KB. CEO directive: large diffs are EXACTLY when review matters most, never silently cap. Bumped to 5MB which covers all realistic single-PR diffs while keeping runner from OOMing.

**Alternatives considered:** Remove cap entirely (rejected — head -c with empty arg errors; keep a high ceiling), Make MAX_DIFF_BYTES configurable but keep 80KB default (rejected — defaults matter; most consumers will never override)

**Implications:**
- Template version bumped v12 → v13. Consumer repos pick up via logmind-self-update workflow.
- Per-repo override still works (consuming workflow can override with lower value).
- Package version 0.6.34 → 0.6.35. Needs tag + publish for downstream consumers.

---

## 2026-06-08 15:20 - fix release discipline: bump strict-mode-gate refs + update prompts.test.js MAX_DIFF_BYTES expectation

**Reasoning:** Three follow-on fixes for v0.6.35: (a) strict-mode-gate@v0.6.34 refs in action.yml + all 3 workflow templates → @v0.6.35 (release-discipline test enforces this), (b) prompts.test.js asserts MAX_DIFF_BYTES literal — bumped expectation to '5000000' to match the new template default.

**Alternatives considered:** Revert template MAX_DIFF_BYTES change (rejected — that was the whole point of v0.6.35)

**Implications:**
- 361/361 tests pass
- release-discipline guard now happy: package.json + every action.yml header + every workflow template all on v0.6.35

---

