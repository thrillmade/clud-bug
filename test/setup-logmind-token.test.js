// PR #354: `check-doc-links.yml` and `regen-timeline.yml` called
// `thrillmade/setup-logmind@v1.0.1` with no `token:`. The action's
// release-lookup API call runs unauthenticated in that shape, and on
// #354 that hit GitHub's anonymous 60 req/hr rate limit and came back
// 403, failing the check for a reason that has nothing to do with the
// PR under review.
//
// `logmind-self-update.yml` already passed `token: ${{ github.token }}`
// (#329) — every other `setup-logmind` call site in this repo's own
// workflows must match that shape. This test scans every workflow file
// under .github/workflows/, not just the two fixed here, so a future
// call site that omits `token:` fails this test instead of shipping
// another unauthenticated-rate-limit outage.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WORKFLOWS_DIR = join(REPO_ROOT, '.github/workflows');

async function setupLogmindSteps() {
  const files = (await readdir(WORKFLOWS_DIR)).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  const found = [];
  for (const file of files) {
    const doc = parseYaml(await readFile(join(WORKFLOWS_DIR, file), 'utf8'));
    for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        if (typeof step.uses === 'string' && step.uses.startsWith('thrillmade/setup-logmind@')) {
          found.push({ file, jobName, step });
        }
      }
    }
  }
  return found;
}

test('control: this repo has at least one thrillmade/setup-logmind call site (fixture check)', async () => {
  const steps = await setupLogmindSteps();
  assert.ok(steps.length > 0, 'expected to find at least one setup-logmind step under .github/workflows/ — did the fixture list drift?');
});

test('#354: every thrillmade/setup-logmind step passes token: under with:, so the release lookup is authenticated', async () => {
  const steps = await setupLogmindSteps();
  for (const { file, jobName, step } of steps) {
    assert.ok(
      step.with && step.with.token,
      `${file} job "${jobName}": setup-logmind step is missing 'with: token:' — its release-lookup API call runs unauthenticated and can 403 on GitHub's anonymous rate limit (see PR #354)`,
    );
  }
});
