## 2026-05-29 09:40 - 0.0.I.1 (clud-bug code change): skip installing CLAUDE.md block when @AGENTS.md import is present

**Reasoning:** Q4 refinement (0.0.I) added @AGENTS.md eager-import at the top of each consuming repo's CLAUDE.md. That makes the AGENTS.md clud-bug block authoritative and the same block in CLAUDE.md duplicate content (eagerly inlined twice on every session). lib/agents-md.js applyToRepo now branches in the TOUCH_IF_PRESENT loop AND in the .cursor/rules walk: if the file already contains @AGENTS.md at start-of-line, SKIP installing the block AND remove any pre-existing block (migration path). AGENTS.md itself is unaffected — it's the source of truth and ALWAYS gets the block. Two new exported helpers: hasAgentsMdImport(content) for the detection (line-anchored to avoid matching prose mentions); removeBlock(content) for the cleanup (also eats the preceding blank line to avoid leaving a visible dent).

**Alternatives considered:** Detect via filename heuristic (file === 'CLAUDE.md' → skip). Rejected: doesn't compose with cursor/windsurf/copilot — those don't always use @AGENTS.md, only Claude Code's CLAUDE.md syntax does today. The content check is the right signal., Always skip non-AGENTS.md files. Rejected: breaks back-compat for repos that don't use @-import.

**Implications:**
- After this lands, agent-skills/reporulez/rezgen/tokenomics/logmind/clud-bug repos' CLAUDE.md files will lose their clud-bug block on the next clud-bug init/update run. AGENTS.md block stays. Net per-session bytes drop because the same content is no longer present in two files.
- Test fixture: 9 new tests in test/agents-md.test.js covering hasAgentsMdImport line-anchor edge cases, removeBlock idempotence + preserving prose around the block, applyToRepo behavior for (a) skip block on CLAUDE.md with import, (b) clean up stale block on CLAUDE.md with import, (c) back-compat install on CLAUDE.md without import, (d) .cursor/rules walk respects the same rule.

---
## 2026-05-29 09:46 - Release clud-bug v0.6.19 — 0.0.I.1 skip-block-when-import

**Reasoning:** Version bump packaging commit for the 0.0.I.1 behaviour change (see earlier decision on this branch). Bumps package.json + composite-pin lock-step in templates/workflow{,-py,-ts}.yml.tmpl + .github/actions/strict-mode-gate/action.yml header docs from 0.6.18 to 0.6.19. CHANGELOG [0.6.19] entry documents the behaviour change + tests + composite pin.

**Implications:**
- After this lands + v0.6.19 is tagged + npm publishes, consumers running 'clud-bug update' will see their CLAUDE.md (etc.) tool-stub block disappear if they have @AGENTS.md at the top — which all 5 consuming repos now do post-0.0.I.

---
