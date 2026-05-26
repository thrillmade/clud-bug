## 2026-05-26 11:45 - Fix strict-mode-gate body-start matching bug (v0.5.12)

**Reasoning:** CORRECTNESS REGRESSION discovered when this repo dogfooded BB.3 on PR #60. The composite strict-mode-gate (since v0.5.8) used jq filter `.body | startswith("## 🐛 Clud Bug review")` to select the bot review comment. anthropics/claude-code-action prepends a `**Claude finished @user task in Nm Ns** —— [View job](...)` preamble to every bot comment, so the H2 sentinel never appears at body position 0. Filter matched ZERO comments in practice — strict mode silently disabled on every install with strictMode: true since v0.5.8. Fix moves the header-selection from bash regex into lib/skills.js as selectReviewHeader / extractFirstReviewHeaderLine / isCriticalReviewHeader; composite calls into Node via the same SKILLS_LIB pattern as BB.3 v0.5.10 classifier. Header extraction uses multi-line start-of-line anchor (^## 🐛 Clud Bug review) which preserves the "don not trip on quoted sentinels in prose" property the original startswith provided.

**Alternatives considered:** Bash-only fix (one-line jq + grep change). Rejected: leaves the gate untested again, vulnerable to the same class of bug. The v0.5.10 BB.3 stream already established the bash-to-JS pattern for testability; v0.5.12 follows it. Also considered: ship the bash fix as v0.5.12 hotfix and do the JS refactor as v0.5.13. Rejected: refactor is ~30 lines, ships in one PR with full coverage. No reason to fragment.

**Implications:**
- Pinning the composite to v0.5.12 via templates@v6 means existing v5 installs auto-upgrade on next clud-bug update. v0.5.10 and v0.5.8 composite refs are now KNOWN-BROKEN — users on them have ineffective strict mode. The v0.6 GitHub App will reuse selectReviewHeader / isCriticalReviewHeader unchanged when routing parallel calls; single source of truth, no bash-vs-JS drift. 11 new tests cover the regression directly + preserve-safety-property assertions.

---
