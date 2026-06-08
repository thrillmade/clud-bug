← back to [docs/timeline.md](../timeline.md)

## 2026-06-08 17:22 - Phase 2 foundation: TypeScript tooling + vitest test framework + src/ layout (Bug 9 wave)

**Reasoning:** First commit of the Phase 2 npm clud-bug TS migration (per plan §Bug 9 mission plan). Lays the foundation that subsequent .js→.ts conversion commits land on, without touching any production lib/* code yet. Setup: package.json (typescript, vitest, tsx, @types/node devDeps; build/dev/test/test:fixtures scripts; exports map for './core' + '.' subpath; main+types pointing at dist/cli/index.js). tsconfig.json (NodeNext module + moduleResolution per architect recommendation — package ships raw ESM to Node consumers, not Vite/esbuild). vitest.config.ts (pool: forks matches node:test's process isolation; testTimeout 30s for spawnSync-heavy suites). src/core/index.ts + src/cli/index.ts stubs so the exports map resolves from day one. scripts/fixture-check.mjs stub (populated when render-review.ts conversion lands per SPEC §6.6 release gate). 18 test files' imports swapped via sed: 'node:test' → 'vitest'; node:assert calls unchanged (vitest runs them fine). 361/361 tests still pass via vitest.

**Alternatives considered:** Convert tests' assertion style to vitest's expect API (rejected per architect: ~360 assertion calls is mechanical churn with no value + accidental actual/expected inversion risk; node:assert works inside vitest unchanged), Bump version to 0.7.0-rc.1 in this commit (rejected: 4 version-discipline tests fail because templates + action.yml still reference v0.6.35. Version bump cascade belongs in the final 'ship the rc' commit after migration completes, not the foundation), Convert bin/clud-bug.js to TypeScript (rejected per architect risk R7: 59KB readline/spawnSync logic, 3-4h of type-annotation work for zero structural benefit. Keep as JS shim; src/cli/index.ts is the new compiled entry that bin/clud-bug.js will eventually import)

**Implications:**
- tsc -p tsconfig.json builds dist/cli/index.js + dist/core/index.js cleanly (empty exports, ready for content)
- vitest runs the existing .js suite at 361/361 — no semantic change from migrating test framework
- package.json version stays 0.6.35; bumps to 0.7.0-rc.1 in the final 'ship the rc' commit after all conversions land

---

