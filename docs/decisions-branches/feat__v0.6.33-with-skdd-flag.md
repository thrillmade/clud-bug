## 2026-06-01 13:51 - clud-bug v0.6.33: clud-bug init --with-skdd flag (unified install, Node entry mirror of logmind v0.6.8)

**Reasoning:** Symmetric mirror of logmind v0.6.8's --with-skdd. Node-first users get the same one-command bootstrap as Python-first users. Whichever ecosystem the user starts in, the flag pulls in the other tool. Bundle-target naming (--with-skdd) future-proofs for toolchain growth without flag explosion.

**Alternatives considered:** Use --with-logmind specific-tool naming (rejected: flag explosion as toolchain grows; bundle target is the right abstraction), Make logmind a hard dependency in package.json (rejected: forces Node users to have Python even if they only want clud-bug standalone)

**Implications:**
- Pip resolution falls back through pip → pip3 → python -m pip → python3 -m pip. First responding command wins. Broader fallback than the Node side's single npx check because Python install names vary widely across platforms
- Anti-loop: invokes logmind init (NOT logmind init --with-skdd). Mirror of v0.6.8's same guarantee. No mutual recursion

---
