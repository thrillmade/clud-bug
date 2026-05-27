## 2026-05-15 11:59 - Brief other agents in AGENTS.md/CLAUDE.md via a clud-bug block, mirror logmind's pattern

**Reasoning:** Idempotent re-write on init/update so the embedded version + strict-mode line stay current as the repo's clud-bug install ages. Block content lives in lib/agents-md.js bundled with the CLI rather than a template file because it embeds dynamic state.

**Alternatives considered:** Document only in README — rejected because users don't read READMEs of dependencies; the brief needs to live where agents look (AGENTS.md)., Append-only, no marker block — rejected because re-runs would stack duplicates, and version/strict-mode line would go stale., Create CLAUDE.md/GEMINI.md/.cursorrules unconditionally — rejected because we'd proliferate stubs the user didn't ask for; logmind already creates the canonical set when present, we just append where they exist.

**Implications:**
- Block embeds the version + strict-mode state, so clud-bug update rewrites it; tested for idempotency in test/agents-md.test.js.
- AGENTS.md is the only file we'll create-if-missing (canonical cross-tool home). Tool-specific files (CLAUDE.md, GEMINI.md, .cursorrules, .windsurfrules, .clinerules, .continuerules, .cursor/rules/*.md) we only touch when present.
- New baseline skill clud-bug-collaboration ships in templates/skills/baseline/ for now; canonical home moves to thrillmade/agent-skills/skills/clud-bug-collaboration/SKILL.md once user uploads it and we bump the SHA pin.

---
## 2026-05-15 12:05 - Align AGENTS.md strict-mode render with workflow gate predicate

**Reasoning:** Fixed by mirroring the workflow predicate exactly: renderBlock now uses strictMode === true, and both call sites (init and update) pass manifest.strictMode === true. The block predicate and the gate predicate are now identical, so they cannot disagree.

**Alternatives considered:** Render 'unknown' / 'check the manifest' for the undefined case — rejected because it obscures the user's actual state from agents; advisory is the *real* state, that's what should be reported., Default-on at the render layer and let users opt out by writing the field — rejected because it would conflict with bin/clud-bug.js#runInit's intentional preservation of v0.3 advisory installs (gated on manifest.lastUpdate === undefined).

**Implications:**
- renderBlock is now defensive against the footgun: it will only ever render 'on' for an explicit true, even if a future call site forgets to translate manifest state correctly.
- Three regression tests added in test/agents-md.test.js: undefined → off, null → off, v0.3-shaped manifest → off.
- Found by clud-bug-review on PR #25 (thread PRRT_kwDORj7Hfc6CaSK9). The bot's strict-mode-gate didn't fire (header sentinel didn't match the body's 'Critical findings' section), but the inline review surfaced the issue cleanly — exactly what the parallel review setup is for.

---
