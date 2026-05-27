## 2026-05-27 11:43 - fix(vercel.json): guard ignoreCommand against bad VERCEL_GIT_PREVIOUS_SHA

**Reasoning:** Wrap git diff in 'git cat-file -e $SHA' so a missing-object falls through to 'else false' (build) instead of exit 128

**Implications:**
- Defensive even when not currently failing — cludbug.dev was reconnected earlier today; the next site/ change after a long gap could hit the same shallow-clone issue

---
