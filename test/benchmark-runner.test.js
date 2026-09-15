// Tests for scripts/run-benchmark.mjs (#270, SPEC 2.0 §8.2 / §4.9).
//
// Driven through the real CLI with a mocked reviewer (`--dry-run
// --fake-script`), so the cost cap, the result schema and the unverified
// bookkeeping are exercised on the code that actually runs in the workflow.
// No network, no key.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = join(ROOT, 'scripts', 'run-benchmark.mjs');
const SCENARIOS = join(ROOT, 'benchmark', 'scenarios');

let work;

beforeAll(() => {
  // The runner imports the scorer and the recipe builder from dist/, the way
  // scripts/fixture-check.mjs does. CI builds before it tests; a bare local
  // `npm test` may not have.
  if (!existsSync(join(ROOT, 'dist', 'core', 'benchmark-score.js'))) {
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'pipe' });
  }
  work = mkdtempSync(join(tmpdir(), 'benchmark-runner-test-'));
});

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

function run(args, { expectStatus = 0 } = {}) {
  const res = spawnSync('node', [RUNNER, ...args], { cwd: ROOT, encoding: 'utf8' });
  expect(
    res.status,
    `run-benchmark exited ${res.status}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
  ).toBe(expectStatus);
  return res;
}

function script(entries) {
  const path = join(work, `script-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify(entries));
  return path;
}

function out(name) {
  return join(work, name);
}

const KEY = (id) => JSON.parse(readFileSync(join(SCENARIOS, id, 'answer.json'), 'utf8'));

/** A stub `claude` binary: whatever body, run for real through --claude-bin. */
function stub(name, body) {
  const path = join(work, `stub-${name}.mjs`);
  writeFileSync(path, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

const emits = (envelope) => `process.stdout.write(${JSON.stringify(JSON.stringify(envelope))});`;

describe('run-benchmark — result file', () => {
  it('writes latest.json and a history copy with the published schema', () => {
    const dir = out('schema');
    run(['--dry-run', '--out', dir, '--suite', 's1-emergent-marker,c1-clean-escaped-marker', '--trigger', 'schedule']);

    const latest = JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'));
    expect(latest.schemaVersion).toBe(1);
    expect(latest.trigger).toBe('schedule');
    expect(typeof latest.runId).toBe('string');
    expect(typeof latest.startedAt).toBe('string');
    expect(Object.keys(latest.config).sort()).toEqual(
      [
        'cludBugVersion',
        'gitSha',
        'invocation',
        'recipeSha256',
        'reviewerEffort',
        'reviewerModel',
        'reviewersPerScenario',
        'seed',
        'suite',
        'workflowTemplate',
      ].sort(),
    );
    expect(latest.config.recipeSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(latest.cost).sort()).toEqual(
      ['capUsd', 'spendEstimated', 'spentUsd', 'stoppedForCost', 'stopReason'].sort(),
    );
    // Corpus order, not --suite order: the result file has to read the same
    // way every run so two runs can be diffed.
    expect(latest.scenarios.map((s) => s.id)).toEqual(['c1-clean-escaped-marker', 's1-emergent-marker']);

    const history = readdirSync(join(dir, 'history'));
    expect(history).toEqual([`${latest.runId}.json`]);
    expect(readFileSync(join(dir, 'history', history[0]), 'utf8')).toBe(
      readFileSync(join(dir, 'latest.json'), 'utf8'),
    );
  });

  it('mirrors the reviewer invocation from the workflow template it renders the prompt from', async () => {
    // The contract and the system prompt have to come from ONE template. They
    // did not: the contract was read from the generic `workflow.yml.tmpl`
    // while the prompt was rendered for the JS/TS one, so a change to the
    // model or the allow-list a JavaScript repo is actually given moved
    // nothing the benchmark recorded.
    const dir = out('invocation');
    run(['--dry-run', '--out', dir, '--suite', 'c2-clean-union']);
    const latest = JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'));

    const { pickTemplate } = await import('../dist/core/render.js');
    const name = pickTemplate(['javascript']);
    // This is the assertion that pins WHICH file was read: the runner records
    // the name the contract was read from, so reading a different template
    // moves it. The model and effort below cannot do that job alone — the
    // generic and JS/TS templates ship the same model, thinking budget and
    // allow-list today, so both halves of this test pass off either file and
    // only the name tells them apart.
    expect(latest.config.workflowTemplate).toBe(name);

    const tmpl = readFileSync(join(ROOT, 'templates', name), 'utf8');
    expect(latest.config.reviewerModel).toBe(tmpl.match(/^\s*MODEL=(\S+?)(?:\s+#.*)?$/m)[1]);
    expect(latest.config.reviewerEffort).toBe(
      `${tmpl.match(/^\s*MAX_THINKING_TOKENS: '(\d+)'$/m)[1]} thinking tokens`,
    );
  });

  it('scores the system prompt a JavaScript repo is given, not the generic one', async () => {
    const dir = out('recipe');
    run(['--dry-run', '--out', dir, '--suite', 'c2-clean-union']);
    const latest = JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'));

    const { reviewPrompt } = await import('../dist/core/prompts.js');
    const { pickTemplate, templateLanguage } = await import('../dist/core/render.js');
    // The project description is the runner's; stated here so a change to it
    // is a change somebody made on purpose.
    const recipe = (language) =>
      createHash('sha256')
        .update(reviewPrompt({ projectDescription: 'A small JavaScript module under review.', language }))
        .digest('hex');

    // Every scenario is a `module.mjs`, so `clud-bug init` would render the
    // JS/TS workflow here — and its prompt carries focus bullets the generic
    // one does not, among them the async/await rule b7-emergent-async-race is
    // planted against. Scoring the generic recipe measures one no JavaScript
    // repository is ever given.
    expect(latest.config.recipeSha256).toBe(recipe(templateLanguage(pickTemplate(['javascript']))));
    // Control: the generic variant hashes differently, so this pins the
    // variant rather than just the hashing.
    expect(latest.config.recipeSha256).not.toBe(recipe('generic'));
  });

  it('caps a run that names no cap, from the one default nothing else restates', () => {
    const dir = out('defaultcap');
    run(['--dry-run', '--out', dir, '--suite', 'c2-clean-union']);
    expect(JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8')).cost.capUsd).toBe(12);
  });

  it('marks a dry run so nothing downstream can publish it', () => {
    const dir = out('dryflag');
    run(['--dry-run', '--out', dir, '--suite', 'c2-clean-union']);
    expect(JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8')).dryRun).toBe(true);
  });

  it('refuses to run a fake reviewer into the published results dir', () => {
    // Naming the published dir is the same publication as defaulting to it:
    // `--out benchmark/results` is an explicit `--out`, so the "did you name
    // one at all" check waved it through and a fake score overwrote
    // latest.json — plus a history entry nothing removes.
    for (const args of [[], ['--out', 'benchmark/results'], ['--out', join(ROOT, 'benchmark', 'results') + '/']]) {
      const res = spawnSync('node', [RUNNER, '--dry-run', ...args], { cwd: ROOT, encoding: 'utf8' });
      expect(res.status, args.join(' ')).toBe(1);
      expect(res.stderr, args.join(' ')).toMatch(/--dry-run may not write the published results/);
    }
    // Control: the same dry run with somewhere else to write is fine, so the
    // refusal is the destination and not the dry run.
    run(['--dry-run', '--out', out('dry-elsewhere'), '--suite', 'c2-clean-union']);
  });

  it('refuses a symlink pointing at the published results dir', () => {
    // A string compare alone passes this: the symlink's own path is not
    // `benchmark/results`, so `--out` reads as "somewhere else" while a write
    // through it lands in the published dir all the same. The identity check
    // (device + inode) is what has to catch it.
    const link = out('published-link');
    symlinkSync(join(ROOT, 'benchmark', 'results'), link);
    const res = spawnSync('node', [RUNNER, '--dry-run', '--out', link], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/--dry-run may not write the published results/);
  });

  it('refuses to run a partial suite into the published results dir', () => {
    // A subset scores fewer scenarios and leaves the rest out of the counts
    // rather than unverified, so publishing one would shrink the corpus under
    // the headline with no remainder named (SPEC §2.8). `--claude-bin` names
    // nothing that exists: the refusal has to come before any reviewer runs.
    for (const extra of [[], ['--out', 'benchmark/results']]) {
      for (const suite of ['planted', 's1-emergent-marker']) {
        const res = spawnSync(
          'node',
          [RUNNER, '--suite', suite, ...extra, '--claude-bin', join(work, 'no-such-binary')],
          { cwd: ROOT, encoding: 'utf8' },
        );
        expect(res.status, suite).toBe(1);
        expect(res.stderr, suite).toMatch(/--suite .* may not write the published results/);
      }
    }
    // Control: the same subset with somewhere else to write is fine, so the
    // refusal is about publishing it, not about the subset itself.
    run(['--dry-run', '--out', out('suite-subset'), '--suite', 'planted']);
  });
});

describe('run-benchmark — scoring a mocked reviewer', () => {
  it('scores a catch, a miss and a false positive', () => {
    const dir = out('scored');
    const key = KEY('s1-emergent-marker');
    run([
      '--dry-run',
      '--out',
      dir,
      '--suite',
      's1-emergent-marker,s2-combinatorial-union,c1-clean-escaped-marker',
      '--fake-script',
      script({
        's1-emergent-marker': { findings: [{ file: key.file, line: key.lineRange[0] }] },
        's2-combinatorial-union': { findings: [] },
        'c1-clean-escaped-marker': { findings: [{ file: 'module.mjs', line: 44 }] },
      }),
    ]);

    const latest = JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'));
    expect(latest.totals).toEqual({
      caught: 1,
      total: 2,
      decoysClean: 0,
      decoysTotal: 1,
      falsePositives: 1,
      unverified: 0,
      recallPct: 50,
      precisionPct: 50,
    });
    const verdicts = Object.fromEntries(latest.scenarios.map((s) => [s.id, s.verdict]));
    expect(verdicts).toEqual({
      's1-emergent-marker': 'caught',
      's2-combinatorial-union': 'missed',
      'c1-clean-escaped-marker': 'false-positive',
    });
  });

  it('reports a reviewer that produced nothing as unverified, never clean', () => {
    const dir = out('noreview');
    run([
      '--dry-run',
      '--out',
      dir,
      '--suite',
      'c1-clean-escaped-marker',
      '--fake-script',
      script({ 'c1-clean-escaped-marker': { review: null, reason: 'reviewer output was not JSON' } }),
    ]);
    const latest = JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'));
    expect(latest.scenarios[0].verdict).toBe('unverified');
    expect(latest.scenarios[0].note).toBe('reviewer output was not JSON');
    expect(latest.totals.decoysClean).toBe(0);
    expect(latest.totals.decoysTotal).toBe(0);
    expect(latest.totals.unverified).toBe(1);
  });
});

describe('run-benchmark — the cost cap (SPEC §4.9)', () => {
  it('stops before the call that would breach the cap and records why', () => {
    const dir = out('capped');
    // Every scenario answers its own key: which one the seeded order runs
    // first is not what this test is about.
    const answered = (id) => {
      const key = KEY(id);
      return [id, { findings: [{ file: key.file, line: key.lineRange[0] }], costUsd: 1.0 }];
    };
    const res = run([
      '--dry-run',
      '--out',
      dir,
      '--suite',
      's1-emergent-marker,s2-combinatorial-union,s3-crosscutting-sort',
      '--cost-cap-usd',
      '1.20',
      '--estimate-usd',
      '1.00',
      '--fake-script',
      script(
        Object.fromEntries(
          ['s1-emergent-marker', 's2-combinatorial-union', 's3-crosscutting-sort'].map(answered),
        ),
      ),
    ]);

    const latest = JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'));
    expect(latest.cost.stoppedForCost).toBe(true);
    expect(latest.cost.stopReason).toMatch(/cost cap reached/);
    expect(latest.cost.spentUsd).toBe(1);
    expect(res.stdout).toMatch(/::warning::run-benchmark: cost cap reached/);

    // One scenario reviewed, two never run — and the two are unverified,
    // out of both terms of the ratio rather than counted as passes. Which one
    // ran is the seeded run order's business, not this test's.
    const verdicts = latest.scenarios.map((s) => s.verdict).sort();
    expect(verdicts).toEqual(['caught', 'unverified', 'unverified']);
    expect(latest.totals).toMatchObject({ caught: 1, total: 1, unverified: 2, recallPct: 100 });
  });

  it('charges the estimate for a review whose cost the reviewer never reported', () => {
    // Otherwise the cap only counts what the reviewer volunteers, and the
    // whole corpus runs past it with spentUsd sitting at zero.
    const dir = out('unreported');
    run([
      '--dry-run',
      '--out',
      dir,
      '--suite',
      's1-emergent-marker,s2-combinatorial-union,s3-crosscutting-sort',
      '--cost-cap-usd',
      '1.50',
      '--estimate-usd',
      '1.00',
      '--fake-script',
      script({
        's1-emergent-marker': { findings: [], costUsd: 0 },
        's2-combinatorial-union': { findings: [], costUsd: 0 },
        's3-crosscutting-sort': { findings: [], costUsd: 0 },
      }),
    ]);
    const latest = JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'));
    expect(latest.cost.spendEstimated).toBe(true);
    expect(latest.cost.spentUsd).toBe(1);
    expect(latest.cost.stoppedForCost).toBe(true);
    expect(latest.totals.unverified).toBe(2);
  });

  it('runs the whole suite when the cap is not reached', () => {
    const dir = out('uncapped');
    run([
      '--dry-run',
      '--out',
      dir,
      '--suite',
      's1-emergent-marker,s2-combinatorial-union',
      '--cost-cap-usd',
      '10',
      '--fake-cost-usd',
      '0.01',
    ]);
    const latest = JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'));
    expect(latest.cost.stoppedForCost).toBe(false);
    expect(latest.totals.unverified).toBe(0);
    expect(latest.totals.total).toBe(2);
  });
});

describe('run-benchmark — the order the corpus is run in', () => {
  // The order used to be `readdirSync().sort()`, which puts all six `c*`
  // decoys in one block at indices 11-16, and the scheduled run passes no
  // seed. Any stop inside the first eleven calls scored zero decoys, and a
  // precision figure over no decoys is 100% by arithmetic alone.
  const called = (res) => [...res.stdout.matchAll(/^ {2}(?:reviewed|unverified) +(\S+)/gm)].map((m) => m[1]);

  it('interleaves the clean decoys through the run, so a cost stop scores both halves', () => {
    const dir = out('order-stop');
    const res = run([
      '--dry-run',
      '--out',
      dir,
      '--cost-cap-usd',
      '1.6',
      '--estimate-usd',
      '0.5',
      '--fake-cost-usd',
      '0.5',
      '--run-id',
      'order-stop',
    ]);
    expect(called(res)).toHaveLength(3);

    const latest = JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'));
    expect(latest.cost.stoppedForCost).toBe(true);
    expect(latest.totals.total, 'planted defects scored').toBeGreaterThan(0);
    expect(latest.totals.decoysTotal, 'decoys scored').toBeGreaterThan(0);
    // The result file still reads in corpus order whatever the run order was,
    // so two runs can be diffed line for line.
    expect(latest.scenarios.map((s) => s.id)).toEqual([...latest.scenarios.map((s) => s.id)].sort());
  });

  it('orders from a seed it records, so a stop does not always truncate the same tail', () => {
    const suite = [
      'b4-emergent-accumulator,b5-combinatorial-boundary,b6-crosscutting-timezone,b7-emergent-async-race',
      'c1-clean-escaped-marker,c2-clean-union,c3-clean-sort,c4-clean-async-sequenced',
    ].join(',');
    const order = (seed, name) =>
      called(run(['--dry-run', '--out', out(name), '--suite', suite, '--seed', seed, '--fake-cost-usd', '0.01']));

    expect(order('alpha', 'seed-a1')).toEqual(order('alpha', 'seed-a2'));
    expect(order('beta', 'seed-b1')).not.toEqual(order('alpha', 'seed-a1'));
  });

  it('records the seed it ordered by even when the operator named none', () => {
    // An unrecorded order is an unreproducible run: the scheduled trigger
    // passes no seed, so the run id is the one it falls back to and states.
    const dir = out('seed-default');
    run(['--dry-run', '--out', dir, '--suite', 'c2-clean-union', '--run-id', 'run-77-1']);
    expect(JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8')).config.seed).toBe('run-77-1');
  });
});

describe('run-benchmark — the real reviewer path', () => {
  // Every test above mocks the reviewer inside the runner, which leaves
  // callReviewer/extractReview/callCost — the only code that runs once a key
  // exists — unexercised. `--claude-bin` is the seam: these drive that path
  // for real with a stub binary emitting the CLI's own envelope shapes.
  function realRun(name, body, extraArgs = []) {
    const dir = out(name);
    const res = run(['--out', dir, '--suite', 's1-emergent-marker', '--claude-bin', stub(name, body), ...extraArgs]);
    return { res, latest: JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8')) };
  }

  it('scores a structured_output envelope and bills the cost it reported', () => {
    const key = KEY('s1-emergent-marker');
    const { latest } = realRun(
      'structured',
      emits({
        structured_output: { critical_findings: [{ file: key.file, line: key.lineRange[0] }] },
        total_cost_usd: 0.42,
        is_error: false,
      }),
    );
    expect(latest.dryRun).toBeUndefined();
    expect(latest.scenarios[0].verdict).toBe('caught');
    expect(latest.cost.spentUsd).toBe(0.42);
    expect(latest.cost.spendEstimated).toBe(false);
  });

  it('scores a review the CLI left as fenced JSON in `result`', () => {
    const key = KEY('s1-emergent-marker');
    const review = JSON.stringify({ critical_findings: [{ file: key.file, line: key.lineRange[0] }] });
    const { latest } = realRun(
      'fenced',
      emits({ result: '```json\n' + review + '\n```', usage: { input_tokens: 1000, output_tokens: 100 } }),
    );
    expect(latest.scenarios[0].verdict).toBe('caught');
    // No total_cost_usd: the usage block is priced from the same table
    // `clud-bug usage` bills from, so the two never disagree.
    expect(latest.cost.spentUsd).toBeGreaterThan(0);
  });

  it('reports an is_error envelope as unverified, never clean', () => {
    const { latest } = realRun('iserror', emits({ is_error: true, result: 'credit balance too low' }));
    expect(latest.scenarios[0].verdict).toBe('unverified');
    expect(latest.scenarios[0].note).toMatch(/reviewer reported an error: credit balance too low/);
    expect(latest.totals.unverified).toBe(1);
    expect(latest.totals.total).toBe(0);
  });

  it('charges the estimate for a reviewer that errored or timed out mid-call', () => {
    // It was billing until it died. Charging nothing for it is how a cap gets
    // spent past: every failure would be free, so the whole corpus would run
    // no matter what the cap said.
    const { latest } = realRun('exited', 'process.stderr.write("boom\\n"); process.exit(3);', [
      '--estimate-usd',
      '0.25',
    ]);
    expect(latest.scenarios[0].verdict).toBe('unverified');
    expect(latest.scenarios[0].note).toMatch(/reviewer exited 3/);
    expect(latest.cost.spentUsd).toBe(0.25);
    expect(latest.cost.spendEstimated).toBe(true);
  });

  it('charges nothing when the reviewer binary never started', () => {
    const dir = out('nobinary');
    run([
      '--out',
      dir,
      '--suite',
      's1-emergent-marker',
      '--claude-bin',
      join(work, 'no-such-binary'),
      '--estimate-usd',
      '0.25',
    ]);
    const latest = JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'));
    expect(latest.scenarios[0].verdict).toBe('unverified');
    expect(latest.scenarios[0].note).toMatch(/reviewer did not run/);
    expect(latest.cost.spentUsd).toBe(0);
    expect(latest.cost.spendEstimated).toBe(false);
  });

  it('hands the reviewer what is left of the budget, so one call cannot outspend the cap', () => {
    const argv = join(work, 'budget-argv.json');
    const { latest } = realRun(
      'budget',
      `import { writeFileSync } from 'node:fs';\n` +
        `writeFileSync(${JSON.stringify(argv)}, JSON.stringify(process.argv.slice(2)));\n` +
        emits({ structured_output: { critical_findings: [] }, total_cost_usd: 0.01 }),
      ['--cost-cap-usd', '3'],
    );
    const args = JSON.parse(readFileSync(argv, 'utf8'));
    expect(args[args.indexOf('--max-budget-usd') + 1]).toBe('3');
    expect(latest.cost.capUsd).toBe(3);
  });

  it('hands the reviewer the allow-list from the same template the prompt came from', async () => {
    const argv = join(work, 'tools-argv.json');
    realRun(
      'tools',
      `import { writeFileSync } from 'node:fs';\n` +
        `writeFileSync(${JSON.stringify(argv)}, JSON.stringify(process.argv.slice(2)));\n` +
        emits({ structured_output: { critical_findings: [] }, total_cost_usd: 0.01 }),
    );
    const args = JSON.parse(readFileSync(argv, 'utf8'));
    const passed = args[args.indexOf('--allowedTools') + 1].split(',');

    const { pickTemplate } = await import('../dist/core/render.js');
    const tmpl = readFileSync(join(ROOT, 'templates', pickTemplate(['javascript'])), 'utf8');
    // The MCP inline-comment tool has no server outside the Action, so it is
    // the one entry the runner drops; everything else is the shipped list.
    const shipped = tmpl
      .match(/--allowedTools "([^"]*)"/)[1]
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t && !t.startsWith('mcp__'));
    expect(passed).toEqual(shipped);
  });

  it('reports a review that carries no findings array as unverified, never clean', () => {
    // The fenced-`result` branch parsed whatever JSON it found and scored it.
    // A payload with no `critical_findings` scores as an empty finding set,
    // which on a decoy is indistinguishable from a reviewer that looked and
    // found nothing — the exact confusion §8.2 exists to prevent.
    const dir = out('shapeless');
    run([
      '--out',
      dir,
      '--suite',
      'c1-clean-escaped-marker',
      '--claude-bin',
      stub('shapeless', emits({ result: '```json\n{"summary":"looks fine to me"}\n```', total_cost_usd: 0.01 })),
    ]);
    const latest = JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'));
    expect(latest.scenarios[0].verdict).toBe('unverified');
    expect(latest.scenarios[0].note).toMatch(/critical_findings/);
    expect(latest.totals.decoysClean).toBe(0);
  });

  it('scores a finding whose line is not a line number as missed, never caught', () => {
    // Placement is the scorer's question, per finding: the runner refuses only
    // a payload that is not a review at all. `line: "20"` named no comparable
    // site, and on a planted defect a finding that named no site is a miss.
    const key = KEY('s1-emergent-marker');
    const { latest } = realRun(
      'badline',
      emits({
        structured_output: { critical_findings: [{ file: key.file, line: String(key.lineRange[0]) }] },
        total_cost_usd: 0.01,
      }),
    );
    expect(latest.scenarios[0].verdict).toBe('missed');
    expect(latest.totals).toMatchObject({ caught: 0, total: 1, unverified: 0 });
  });

  it('keeps a correct catch when a second finding in the same review is malformed', () => {
    // One bad `line` among several is a shape an LLM emits routinely, and the
    // fenced branch exists to tolerate exactly that. Voiding the whole review
    // over it discarded a finding that HAD located the planted defect and
    // published the scenario as one that went unscored.
    const key = KEY('s1-emergent-marker');
    const { latest } = realRun(
      'mixedshape',
      emits({
        structured_output: {
          critical_findings: [
            { file: key.file, line: key.lineRange[0], summary: 'the real catch' },
            { file: 'other.mjs', line: '12', summary: 'a second finding with a string line' },
          ],
        },
        total_cost_usd: 0.01,
      }),
    );
    expect(latest.scenarios[0].verdict).toBe('caught');
    expect(latest.totals).toMatchObject({ caught: 1, total: 1, unverified: 0, recallPct: 100 });
  });

  it('publishes how the benchmark differs from a real PR review', () => {
    // The published sentence interpolates config.invocation verbatim, so a
    // divergence that is not named here is named nowhere the number travels.
    const { latest } = realRun(
      'divergence',
      emits({ structured_output: { critical_findings: [] }, total_cost_usd: 0.01 }),
    );
    for (const clause of ['headless', 'no PR context', '`gh`', 'inline-comment', 'two-commit']) {
      expect(latest.config.invocation, clause).toContain(clause);
    }
  });
});

describe('the invocation contract across the shipped templates', () => {
  // The runner reads the model, the thinking budget and the tool allow-list out
  // of ONE template — whichever `clud-bug init` would render for this corpus —
  // and every assertion above passes off whichever file it happens to read,
  // because the three templates ship the same values TODAY. That agreement is
  // an assumption nothing else states: when it breaks, the benchmark quietly
  // measures a recipe some repositories are not given. This is the guard on it.
  const TEMPLATES = ['workflow.yml.tmpl', 'workflow-ts.yml.tmpl', 'workflow-py.yml.tmpl'];
  const FIELDS = [
    ['--allowedTools', /--allowedTools "([^"]*)"/],
    ['MODEL', /^\s*MODEL=(\S+?)(?:\s+#.*)?$/m],
    ['MAX_THINKING_TOKENS', /^\s*MAX_THINKING_TOKENS: '(\d+)'$/m],
  ];

  it.each(FIELDS)('ships one %s across every workflow template', (field, pattern) => {
    const values = TEMPLATES.map((name) => {
      const found = readFileSync(join(ROOT, 'templates', name), 'utf8').match(pattern);
      expect(found, `${name} carries no ${field} line the runner can read`).toBeTruthy();
      return [name, found[1]];
    });
    expect(
      new Set(values.map(([, value]) => value)).size,
      `${field} diverges across the templates:\n${values.map(([n, v]) => `  ${n}: ${v}`).join('\n')}`,
    ).toBe(1);
  });
});

describe('the scheduled workflow', () => {
  const source = () => readFileSync(join(ROOT, '.github', 'workflows', 'benchmark.yml'), 'utf8');
  const workflow = () => parseYaml(source());
  const scoreStep = () => workflow().jobs.benchmark.steps.find((s) => s.name === 'Score the corpus');

  it('runs one benchmark at a time, so two triggers cannot spend two caps', () => {
    // The Monday cron and a dispatch can overlap, and each enforces its own
    // cap against the same key. Queued rather than cancelled: whatever is in
    // flight has already spent.
    const { concurrency } = workflow();
    expect(concurrency.group).toBeTruthy();
    expect(concurrency['cancel-in-progress']).toBe(false);
  });

  it('leaves the cost cap default to the runner rather than restating it', () => {
    const input = workflow().on.workflow_dispatch.inputs.costCapUsd;
    expect(input, 'the operator can still choose a cap').toBeTruthy();
    expect(input.default, 'a second default is a second owner of the number').toBeUndefined();
    expect(source()).toMatch(/--cost-cap-usd "\$COST_CAP_USD"/);
    expect(source(), 'no literal cap anywhere in the workflow').not.toMatch(/--cost-cap-usd ['"]?\d/);
  });

  it('publishes only a whole-corpus run', () => {
    // A subset names no remainder, so it is scored to scratch and left
    // unpublished; the runner refuses it into the results dir either way.
    const run = scoreStep().run;
    expect(run).toMatch(/if \[ "\$SUITE" = all \]; then\n\s*if node scripts\/render-benchmark\.mjs; then/);
    expect(run).toMatch(/if \[ "\$SUITE" != all \]/);
  });

  it('keeps the last published score when a run is not publishable', () => {
    // readLatest refuses a run that scored nothing on one side of the corpus.
    // Letting that fail the step would go red on the schedule — "a benchmark
    // that goes red is a benchmark someone turns off" — and leaving the
    // refused file in place would put an unpublishable result in the PR.
    const run = scoreStep().run;
    expect(run).toMatch(/cp "\$RUNNER_TEMP\/previous-latest\.json" benchmark\/results\/latest\.json/);
    expect(run).toMatch(/::warning title=Benchmark not published::/);
    expect(run).toMatch(/published=\$PUBLISHED/);
  });

  it('titles the PR from the run it made, not from whatever latest.json says', () => {
    const pr = workflow().jobs.benchmark.steps.find((s) => s.name === 'Open a PR with the result').run;
    expect(pr).toMatch(/history\/' \+ process\.env\.RUN_ID/);
    expect(pr, 'a refused run must say so on its own PR').toMatch(/not publishable/);
  });
});

describe('run-benchmark — the materialised scenario repo', () => {
  // SPEC §8.2: "The defect lives in the reviewer's input, never in the
  // change." A cross-cutting scenario is what distinguishes the two — the
  // cause sits in a pre-existing file the change only exposes, so that file
  // must be in the base commit and absent from the diff.
  it('keeps the pre-existing file out of the diff and module.mjs in it', () => {
    const dir = out('materialised');
    run(['--materialise-only', dir, '--suite', 'b6-crosscutting-timezone']);
    const repo = join(dir, 'b6-crosscutting-timezone');

    const changed = execFileSync('git', ['diff', '--name-only', 'main...HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    })
      .trim()
      .split('\n');
    expect(changed).toEqual(['module.mjs']);
    expect(existsSync(join(repo, 'daycalc.mjs'))).toBe(true);
  });

  it('withholds the answer key, the write-up and the reproduction from the reviewer', () => {
    const dir = out('withheld');
    run(['--materialise-only', dir, '--suite', 'b6-crosscutting-timezone,s1-emergent-marker']);
    for (const id of ['b6-crosscutting-timezone', 's1-emergent-marker']) {
      const present = readdirSync(join(dir, id)).sort();
      expect(present).not.toContain('SCENARIO.md');
      expect(present).not.toContain('answer.json');
      expect(present).not.toContain('reproduce.mjs');
      expect(present).toContain('module.mjs');
    }
  });

  it('pins the review skills into the base commit, the way the Action does', () => {
    const dir = out('skills');
    run(['--materialise-only', dir, '--suite', 's2-combinatorial-union']);
    const repo = join(dir, 's2-combinatorial-union');
    expect(existsSync(join(repo, '.claude', 'skills', '.clud-bug.json'))).toBe(true);
    const changed = execFileSync('git', ['diff', '--name-only', 'main...HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    expect(changed).toBe('module.mjs');
  });
});
