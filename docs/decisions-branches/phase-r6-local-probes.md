← back to [docs/timeline.md](../timeline.md)

## 2026-07-03 12:32 - Phase R6-local: wire .clud-bug.json invariants into the recipe's §3c probe-run step

**Reasoning:** R1 built the invariants config + shouldRunProbes gate; R2 taught the recipe that a reproduction grounds a finding. R6-local connects them: the local recipe now renders a §3c 'Invariant probes' step (mirroring the §3b design step) — gated by shouldRunProbes (repo declared valid invariants + pr trigger). It lists each invariant (name/appliesTo/probe/expect) and tells the agent to run the probe for any invariant whose appliesTo globs match a changed file, subject to execution-safety (never run an untrusted diff), RED=grounded finding, and to post the R3 'unverified' verdict for a touched-but-unrunnable invariant. The appliesTo-vs-changed-paths filter is deferred to the agent (paths aren't known at render). Threads invariants through renderReviewRecipe + runReviewPrompt exactly like design.

**Alternatives considered:** Run probes on the commit trigger too (rejected: build+run is expensive; pr is the gate, same cost model as the design pass), Filter invariants by changed paths at render time (rejected: the recipe renders before the agent fetches the diff, so paths are unknown — defer the glob filter to the runtime step, like design defers the preview-URL check)

**Implications:**
- R6-action (the Action's sandboxed CI job that runs probes for untrusted PRs) is next — the serverless hosted path can't run probes, so the CI job is the execution surface + the belt-and-suspenders behind R2's execution-safety guard

---

