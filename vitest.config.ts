import { defineConfig } from 'vitest/config';
import { existsSync, statSync } from 'node:fs';
import { resolve as pathResolve, dirname } from 'node:path';

// pool: 'forks' matches `node:test`'s process-isolation model.
// audit.test.js and update.test.js spawn child processes and create
// temp git repos — threads would cause spawnSync('git') collisions.
//
// During the v0.7.0 migration we run BOTH .js test files (still using
// `import { test } from 'vitest'` after the mechanical S1 swap) and any
// new .ts test files. The include pattern covers both.
//
// NodeNext-style `.js` imports of `.ts` files: tests carry the
// architect-mandated `from '../src/core/<name>.js'` form (per Phase 2
// rule — NodeNext requires the `.js` extension even when the on-disk
// file is `.ts`). Vite's built-in resolver only swaps `.js`→`.ts` when
// the IMPORTER is a `.ts` file; our test files are `.js`, so we install
// a small plugin that performs the swap for relative imports into the
// `src/` tree. Scope is intentionally narrow (only `src/`, only when
// the `.js` file is absent and a sibling `.ts` exists) so it can't
// hide a missing-file bug in `lib/` or templates/.
export default defineConfig({
  plugins: [
    {
      name: 'clud-bug:nodenext-js-to-ts',
      enforce: 'pre',
      async resolveId(source, importer) {
        if (!importer) return null;
        if (!source.endsWith('.js')) return null;
        if (!source.startsWith('.') && !source.startsWith('/')) return null;
        const abs = pathResolve(dirname(importer), source);
        if (!abs.includes(`${pathResolve(__dirname, 'src')}`)) return null;
        if (existsSync(abs) && statSync(abs).isFile()) return null;
        const tsCandidate = abs.replace(/\.js$/, '.ts');
        if (existsSync(tsCandidate) && statSync(tsCandidate).isFile()) {
          return tsCandidate;
        }
        return null;
      },
    },
  ],
  test: {
    include: ['test/**/*.test.{js,ts}'],
    environment: 'node',
    globals: false,
    pool: 'forks',
    // Give the suite room — spawnSync calls to git/gh/node can each take
    // a few seconds on cold runs. Default 5s is too tight for the audit
    // tests which fan out across multiple temp repos.
    testTimeout: 30000,
  },
});
