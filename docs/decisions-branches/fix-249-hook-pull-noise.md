← back to [docs/timeline.md](../timeline.md)

## 2026-07-26 21:05 - Fix #249: local review hook re-fires on pull/merge of already-reviewed commits — add authorship filter

**Reasoning:** The #240/#245 reflog gate correctly keys firing on git STATE (why HEAD moved), but pull*/merge* in the allowed-verb list means a routine git pull that fast-forwards onto a teammate's already-reviewed, already-merged PR commit re-triggers a local review — pure noise, ~$0.08/fire, and a habituation risk for the local tier (#228). Per #249's ruling, keep the reflog gate (preserves #240 vector 3's git-state approach) and add an authorship check: compare the new HEAD commit's author (email + name, case-insensitive, either matching) against local git config identity; skip firing only when both provably mismatch. A hand-resolved local merge or a real non-ff git merge still fires because the merge commit's author is whoever ran the merge (the local user), regardless of whose branch was merged in — only a foreign commit reached via fast-forward (no new commit object) is skipped.

**Alternatives considered:** Option 1 (drop pull*/merge* from the verb list) was rejected per the issue's own ruling: it would silently skip a hand-resolved local merge commit, which IS the user's own work and should be reviewed. Option 3 (fire only when HEAD moves to a commit not reachable from the previous upstream) was rejected as the most complex option, not required by the ruling, which explicitly calls for option 2 (authorship filter).

**Implications:**
- The filter fails OPEN (fires) whenever local identity is unset (no user.email/user.name at all, checked via git config, isolated from global config in the identity-unset test) or the commit's author can't be read — a false fire is noise, a false skip is an unreviewed commit, the exact bug class #239/#240 exist to prevent. Matching on EITHER email OR name (not requiring both) accommodates the same human authoring commits under different emails across machines, which this repo's own history demonstrates (dev@thrillmade.com / devintwilmot@gmail.com / thrillmot@users.noreply.github.com, one stable name). Regenerated .claude/settings.json via 'node bin/clud-bug.js update' since the hook command string changed; reverted the unrelated version-footer/skill-manifest side effects the same update run produced in .cursorrules, AGENTS.md, and .claude/skills/.clud-bug.json to keep the diff scoped to this fix.

---

