← back to [docs/timeline.md](../timeline.md)

## 2026-09-15 21:21 - Action templates resolve the CLI outside the PR workspace, upsert the review comment, and stop overclaiming the skill-read cap (#331, #332, #259 item 1)

**Reasoning:** The review job resolved clud-bug through npx from the checked-out PR, so a committed node_modules bin or package.json bin in the PR could replace the reviewer; every job now installs the pinned version into an isolated directory outside the workspace and calls that binary. The review comment is edited in place through one helper that pages the full comment list, selects by the bot identity, and refuses to create when the lookup itself fails. The strict-mode gate pages too and selects by identity, never recency. The allow-list drops the uncapped skill reads it carried, and the docs now say honestly that the allow-list documents the intended recipe while the prompt builder truncation is what bounds skill bytes. CI now renders and lints every template, which surfaced two real shellcheck findings in self-update.

**Alternatives considered:** Pin the npx call to a checksum (rejected: resolution still starts from the PR workspace), Require the written-by marker in the gate (rejected: the action default identity never stamps it, so the gate failed open), Template the byte count into the allow-list (rejected: the benchmark runner reads the raw template)

**Implications:**
- Customers pick up the new templates through clud-bug update
- The literal 8192 in the allow-list is test-pinned to DEFAULT_MAX_SKILL_BYTES

---

