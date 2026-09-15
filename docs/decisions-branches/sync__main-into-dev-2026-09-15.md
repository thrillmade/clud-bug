← back to [docs/timeline.md](../timeline.md)

## 2026-09-15 09:53 - Sync dev with main (22 commits): dev's content is the truth, plus main's dependency bumps including vitest 5

**Reasoning:** Promotions dev→main are squash commits, so git saw 16 conflicts although main carried no unique content: every conflicting source/template/test/doc hunk on main's side was dev's own earlier work (verified per file with git diff origin/dev origin/main), so each took dev's version byte-for-byte. Main's only genuine additions were dependabot bumps (#322 #324 #325 #326 #327, incl. vitest 4→5 and @types/node 26.4.1): manifests keep dev's structure with the newer of each version; lockfiles regenerated (npm 12 resolver via npx, scoped to this tree, because npm 11.3 crashes on vitest 5's optional-peer graph in strict mode) rather than hand-merged. .ci-rendered/* stays deleted (#320). CHANGELOG keeps dev's side (main added no entries). Verified: content diff vs origin/dev outside manifests is empty; 57 files / 1233 tests green under vitest 5 in this tree; main's own test job is green on node 20 with vitest 5 so ci.yml's node pin is left alone.

**Alternatives considered:** Hand-merge the lockfiles (rejected: arborist consistency is exactly what a hand merge gets wrong), --legacy-peer-deps on npm 11.3 (rejected: silently downgrades peer-conflict enforcement for the whole resolution)

**Implications:**
- Transitive packages float forward to current registry publishes within their ranges
- site/package-lock.json carries one moderate audit finding (baseline-browser-mapping, via Next 16.3.x) inherited from main — filed separately

---

