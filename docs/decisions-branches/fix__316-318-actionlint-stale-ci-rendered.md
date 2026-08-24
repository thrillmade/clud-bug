← back to [docs/timeline.md](../timeline.md)

## 2026-08-24 13:34 - Fix #316 actionlint SC2016 + #318 stale tracked .ci-rendered goldens

**Reasoning:** actionlint was red on every PR from 3 identical shellcheck SC2016 hits: the fork/bot skip-notice BODY=$(printf '...') in each workflow template single-quotes literal Markdown backticks (`clud-bug-review`, `neutral`, `success`) for the PR comment body. Verified with shellcheck directly (JSON span col19-422 = the whole quoted string) and a minimal repro: backticks alone trigger SC2016 even with no $ present, and double-quoting would make the shell actually try to command-substitute them — single quotes are correct, not a bug. Separately, tracked .ci-rendered/*.yml had drifted 71-140 changed lines/file from templates/*.yml.tmpl since e105f2d; control-tested whether anything reads the tracked copy (grep clud-bug-app + site/: 0 hits, vs 737/13 hits on a known-present control string, so the greps work) and read ci.yml's actionlint job directly — it mkdir's + renders its own throwaway .ci-rendered/ on the runner and lints that, never the tracked one; package.json files[] also excludes it from the npm tarball. Nothing depends on the tracked copy, so deleted + gitignored per #318's stated fallback for a zero-reference control test.

**Alternatives considered:** Repo-wide shellcheck disable (rejected: same failure class as the ignoreDeprecations blanket #313 deleted — would also hide a real future SC2016 typo), Double-quote the printf string (rejected: the backticks would then be live command substitution — gh/clud-bug-review/neutral/success would execute as commands, breaking the composed comment body), Regenerate .ci-rendered/ + add a render+diff --exit-code drift job (rejected: control test came back zero, so there is nothing to keep in sync with — the file would only be able to go stale again)

**Implications:**
- actionlint clean locally (re-rendered + linted all 3 templates, exit 0) and full suite green: 54 files / 1193 tests, test:fixtures 5/5, check-version, check-links. .ci-rendered/ is now gitignored — scripts/render-ci.mjs still works for local linting, CI's own render step is untouched.

---

