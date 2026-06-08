import { defineConfig } from 'vitest/config';

// pool: 'forks' matches `node:test`'s process-isolation model.
// audit.test.js and update.test.js spawn child processes and create
// temp git repos — threads would cause spawnSync('git') collisions.
//
// During the v0.7.0 migration we run BOTH .js test files (still using
// `import { test } from 'vitest'` after the mechanical S1 swap) and any
// new .ts test files. The include pattern covers both.
export default defineConfig({
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
