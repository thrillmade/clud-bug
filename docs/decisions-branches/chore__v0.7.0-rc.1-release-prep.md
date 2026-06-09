← back to [docs/timeline.md](../timeline.md)

## 2026-06-09 16:03 - Release prep v0.7.0-rc.1: version bump + strict-mode-gate classifier vendor + sourcemap fix

**Reasoning:** Three things bundled because they're all release-coordinated. (1) package.json version 0.6.35 → 0.7.0-rc.1. (2) Strict-mode-gate's SKILLS_LIB pointed at lib/skills.js but that file was deleted in PR #156; vendor selectReviewHeader + isCriticalReviewHeader + extractFirstReviewHeaderLine into .github/actions/strict-mode-gate/classifier.mjs as buildless pure-JS copies. Equivalence test (test/strict-mode-gate-classifier.test.js) prevents drift between vendored and src/core/skills.ts. (3) package.json 'files' array adds 'src' so the published tarball's sourcemaps resolve (declarationMap + sourceMap reference ../src/*.ts). Tests fixed: cli.test.js regex + release-discipline regex both broadened to allow pre-release suffix (e.g. -rc.1) per proper semver. Templates: 3 workflow templates' strict-mode-gate refs bumped to v0.7.0-rc.1. action.yml header docstring example bumped to v0.7.0-rc.1. 365/365 tests pass (361 baseline + 4 vendoring equivalence).

**Alternatives considered:** Make the action build clud-bug at composite-runtime (rejected: ~30s overhead per strict-mode PR + adds npm-permission requirements to every consumer; vendoring 3 pure functions is the right shape), Bump to v0.7.0 final (without -rc) (rejected: pre-release tag lets npm consumers opt-in via 'next' dist-tag without polluting latest; standard semver pattern), Use tsconfig.build.json with maps off for the publishable build (rejected: adding 'src' to files is simpler + better dev experience — consumer debugger can step into source)

**Implications:**
- v0.7.0-rc.1 ready to tag + npm publish --tag next after merge
- Strict-mode-gate now works correctly when consumers pin to v0.7.0-rc.1 (would have errored on missing lib/skills.js otherwise)
- Published tarball includes src/ so sourcemaps resolve

---

