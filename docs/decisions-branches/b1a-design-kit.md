← back to [docs/timeline.md](../timeline.md)

## 2026-06-29 08:12 - design-critic B1a: add kind:design skill lens + ship the design baseline kit

**Reasoning:** First half of the design-critic lens (Track B). Adds 'design' as a third SkillKind alongside rule/voice so design skills route to a visual pass; ships a 3-skill design baseline kit (design-system-consistency, visual-polish, frontend-a11y) that reviews the RENDERED surface (screenshots) — each kind:design + review_mode:dedicated + applies_to frontend globs, encoding the elite bar and told to flag 'fine but not elite'.

**Alternatives considered:** A 'lens:' frontmatter field instead of a new kind — rejected: kind is the existing category axis and flows through manifest/list/refresh; design needs no extra required field (unlike voice/voice_scope)

**Implications:**
- Additive — kind:design parses with no voice_scope required; the kit files are inert until installed (the installer + design config + recipe step land in B1b/rc.15)
- diffManifest handling for kind:design rides with B1b's installer

---

