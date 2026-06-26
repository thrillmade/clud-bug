← back to [docs/timeline.md](../timeline.md)

## 2026-06-25 21:05 - Bake PKG_VERSION at build time, eliminating runtime fs.readFileSync of package.json

**Reasoning:** src/core/render.ts previously did readFileSync(__dirname + '/../../package.json') at module-load to read the version. Under Next.js bundling in clud-bug-app (App-side consumer), import.meta.url resolved to .next/server/... not the node_modules layout, so the fs call threw ENOENT. Phase 5.1 hotfix worked around this with serverExternalPackages in next.config.js but the proper fix is on the npm side. Codegen src/core/version.ts at build time (via prebuild script reading package.json) so consumers never face the fs lookup. Same pattern as clud-bug-app's lib/baseline-skills/skills.gen.ts (PR #51).

**Alternatives considered:** Keep runtime readFileSync + tell consumers to add serverExternalPackages — leaves a hidden fragility every consumer must learn about, Move version into a runtime config object passed by consumers — adds API surface for every existing caller, breaking change

**Implications:**
- src/core/version.ts is git-ignored to avoid main/branch drift; consumers always see version that matches installed package.json (regenerated on every npm run build via prebuild + npm test via pretest)
- Templates referencing strict-mode-gate@vX.Y.Z need bumping in lockstep with package.json version (3 template files + 1 action.yml header). Captured by existing release-discipline tests.

---

