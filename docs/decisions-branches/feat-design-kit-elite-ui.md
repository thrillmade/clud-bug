← back to [docs/timeline.md](../timeline.md)

## 2026-07-04 00:34 - Add designing-elite-ui as a 4th bundled kind: design skill in the CLI design-kit

**Reasoning:** The hosted design-critic (design-pass.ts buildDesignPrompt) feeds every kind: design skill body verbatim into the visual critic prompt. The design-kit at templates/skills/design/ is directory-driven (loadDesignKit reads every .md and stamps kind: design + source: clud-bug-design), so dropping the file in makes the elite bar a bundled default that 'init --with-design' pins and the hosted pass measures against — no loader/code change. Gives the critic a concrete elite standard (one-axis color, APCA contrast, floating stable chrome, dark parity) instead of a vague 'looks fine'.

**Alternatives considered:** Bundle it in clud-bug-app/lib/baseline-skills — rejected: baseline is the no-manifest code-review fallback (kind: baseline), not design; design defaults live only in the CLI design-kit (bundled-only, no agent-skills upstream per loadDesignKit doc)., Rewrite the body into terse critic instructions like the 3 siblings — rejected: fold it in verbatim; the principles + gotchas table + worked example ARE the measurable bar.

**Implications:**
- test/init-with-design.test.js now pins the exact 4-slug set (deepEqual) and >=4 count; the '3 kind: design skills' help/comment strings in main.ts bumped to 4.
- Description flows only to the manifest/dashboard listing (buildDesignPrompt uses name+body only), so it was adapted to the sibling 'Visual review —' format while the SKILL body stays verbatim from ~/.claude/skills/designing-elite-ui.

---

