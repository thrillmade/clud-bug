← back to [docs/timeline.md](../timeline.md)

## 2026-07-28 00:20 - F1a: fix the forgeable clud-bug-review merge gate — integration_id pin

**Reasoning:** SPEC 10.3.3 point 2 requires the required-status-check entry to pin integration_id to the clud-bug App, so only the App can satisfy the gate. Three independent defects meant no repo configured by clud-bug ever had it. One: the vendored presets omitted the pin, while reporulez the canonical source has carried it since Z6 landed — our copies were stale. Two: mergeForPut rebuilt every entry as a bare context object, dropping the pin on every apply including one set by hand in the GitHub UI, so a correctly-configured repo was downgraded back to forgeable on the next run. Three: the diff treated an unpinned context as canonical, reporting already-canonical while the gate stayed open. Net effect: any actor with checks:write, including the PR author, could post a check named clud-bug-review and win on latest-run-wins semantics.

**Alternatives considered:** Re-vendor all preset files wholesale from reporulez — rejected: JSON.stringify reformatting buried the one semantic change in ~100 lines of whitespace noise, which is the wrong diff to hand a reviewer for a security fix. Surgical edit instead., Only add the pin to the presets — insufficient: mergeForPut would strip it again on the next apply, so the fix would silently undo itself.

**Implications:**
- New statusCheckEntries helper preserves context plus integration_id; the string-only statusCheckContexts stays for human-readable diff labels
- unionContexts deleted rather than left dead — a string-only union is exactly the convenient helper a future edit would reach for, reintroducing the strip
- Precedence on merge: our entry wins for contexts we ship, so the canonical pin cannot be downgraded; a repo extra context keeps its own pin
- Three regression tests, control-tested: reintroducing the strip fails 2 of them; the third covers the diff half independently
- Re-run clud-bug configure-github to converge repos already configured with the unpinned gate

---

