// Tests for the published-claim renderer and its drift gate (#270).
//
//   scripts/render-benchmark.mjs      — the only writer of every benchmark number
//   scripts/check-benchmark-claims.mjs — CI's byte-compare against it
//
// The end-to-end gate is exercised by running the checker over the committed
// tree; the per-number bite is exercised on the pure renderer, so a mutated
// result file provably changes what would be published.

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scoreRun } from '../src/core/benchmark-score.js';
import {
  LATEST,
  MARKDOWN_TARGETS,
  SITE_CONST,
  benchmarkFacts,
  benchmarkSentence,
  derivedTotals,
  jsxBlockViolations,
  readLatest,
  renderTargets,
} from '../scripts/render-benchmark.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const committed = JSON.parse(readFileSync(LATEST, 'utf8'));

/** A copy of the committed result, mutated, written where readLatest can read it. */
function fixture(mutate) {
  const path = join(mkdtempSync(join(tmpdir(), 'benchmark-claims-')), 'latest.json');
  const result = JSON.parse(JSON.stringify(committed));
  mutate(result);
  writeFileSync(path, JSON.stringify(result));
  return path;
}

describe('benchmark/results/latest.json', () => {
  it('is a real run, never a dry run', () => {
    expect(committed.dryRun).toBeUndefined();
    expect(() => readLatest()).not.toThrow();
  });

  it('carries every field the published wording is rendered from', () => {
    expect(committed.schemaVersion).toBe(1);
    expect(typeof committed.runId).toBe('string');
    expect(committed.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(committed.config).toHaveProperty('invocation');
    expect(committed.config).toHaveProperty('reviewersPerScenario');
    expect(committed.cost).toHaveProperty('stoppedForCost');
    for (const field of [
      'caught',
      'total',
      'decoysClean',
      'decoysTotal',
      'falsePositives',
      'unverified',
      'recallPct',
      'precisionPct',
    ]) {
      expect(typeof committed.totals[field], field).toBe('number');
    }
  });

  it('scores every scenario in the committed corpus', () => {
    const ids = committed.scenarios.map((s) => s.id).sort();
    expect(new Set(ids).size).toBe(ids.length);
    expect(committed.totals.total + committed.totals.decoysTotal + committed.totals.unverified).toBe(
      committed.scenarios.length,
    );
  });
});

describe('render-benchmark', () => {
  it('refuses to publish a dry run', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'benchmark-claims-')), 'latest.json');
    writeFileSync(path, JSON.stringify({ ...committed, dryRun: true }));
    expect(() => readLatest(path)).toThrow(/dry run/);
    // Control: the same file without the flag reads fine, so the throw is the
    // flag and not the fixture.
    writeFileSync(path, JSON.stringify(committed));
    expect(() => readLatest(path)).not.toThrow();
  });

  it('refuses totals its own scenarios do not add up to', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'benchmark-claims-')), 'latest.json');
    const mutated = JSON.parse(JSON.stringify(committed));
    // Every planted scenario still reads `caught`, so only the headline moved
    // — which is exactly the state nothing else in the pipeline can see.
    mutated.totals.caught -= 1;
    writeFileSync(path, JSON.stringify(mutated));
    expect(() => readLatest(path)).toThrow(/totals disagree with its own scenarios/);
    // Control: the same fixture unmutated reads fine.
    writeFileSync(path, JSON.stringify(committed));
    expect(() => readLatest(path)).not.toThrow();
  });

  it('counts the way the scorer counts', () => {
    // src/core/benchmark-score.ts owns the rules; derivedTotals is the
    // cross-check the published file is held to. This is what stops the two
    // from drifting apart into a gate that passes the wrong arithmetic.
    const site = { file: 'module.mjs', lineRange: [10, 20] };
    const keys = [
      { id: 'caught', class: 'emergent', expected: 'finding', ...site },
      { id: 'missed', class: 'emergent', expected: 'finding', ...site },
      { id: 'decoy-clean', class: 'clean', expected: 'clean', ...site },
      { id: 'decoy-flagged', class: 'clean', expected: 'clean', ...site },
      { id: 'unrun', class: 'emergent', expected: 'finding', ...site },
    ];
    const scored = scoreRun(
      [
        { id: 'caught', review: { critical_findings: [{ file: 'module.mjs', line: 12 }] } },
        { id: 'missed', review: { critical_findings: [] } },
        { id: 'decoy-clean', review: { critical_findings: [] } },
        { id: 'decoy-flagged', review: { critical_findings: [{ file: 'module.mjs', line: 3 }] } },
        { id: 'unrun', review: null, unverifiedReason: 'cost cap reached' },
      ],
      keys,
    );
    expect(scored.totals).toMatchObject({ caught: 1, total: 2, falsePositives: 1, unverified: 1 });
    expect(derivedTotals(scored.scenarios)).toEqual(scored.totals);
  });

  it('refuses a result that does not score every scenario in the committed corpus', () => {
    // `config.suite: 'all'` is a label the result file writes about itself. A
    // file that dropped the six decoys still says `all`, and its 14-scenario
    // headline rendered and passed the drift gate — the corpus on disk is the
    // only thing that can contradict it.
    const path = fixture((result) => {
      result.scenarios = result.scenarios.filter((s) => s.expected !== 'clean');
      Object.assign(result.totals, { decoysClean: 0, decoysTotal: 0, falsePositives: 0 });
    });
    expect(() => readLatest(path)).toThrow(/committed corpus/);
    // Control: the same fixture with the decoys back reads fine, so the throw
    // is the missing scenarios and not the rewrite.
    expect(() => readLatest(fixture(() => {}))).not.toThrow();
  });

  it('refuses a result that scores one scenario twice', () => {
    // The corpus check was membership in both directions over a Map keyed by
    // id, which dedupes in silence. Nine extra copies of an already-caught
    // planted scenario turned 11 of 14 into 20 of 23, and every other door —
    // `suite: all`, the re-derived totals, the byte-compare — passed it.
    const path = fixture((result) => {
      const caught = result.scenarios.find((s) => s.expected === 'finding' && s.verdict === 'caught');
      for (let i = 0; i < 9; i++) result.scenarios.push(JSON.parse(JSON.stringify(caught)));
      Object.assign(result.totals, derivedTotals(result.scenarios));
    });
    expect(() => readLatest(path)).toThrow(/scored twice/);
    // Control: the same fixture with one entry per scenario reads fine, so the
    // throw is the repeat and not the rewrite.
    expect(() => readLatest(fixture(() => {}))).not.toThrow();
  });

  it('refuses a result whose scenario contradicts the committed answer key', () => {
    const path = fixture((result) => {
      const decoy = result.scenarios.find((s) => s.expected === 'clean');
      decoy.expected = 'finding';
    });
    expect(() => readLatest(path)).toThrow(/committed corpus/);
  });

  it('refuses a run that scored no planted defect at all', () => {
    // A revoked key leaves every scenario unverified, and 0/0 rendered as
    // "caught 0/0 (0%)" — a sentence that reads as a measured failure rather
    // than as nothing having been measured.
    const path = fixture((result) => {
      for (const s of result.scenarios) {
        s.verdict = 'unverified';
        s.note = 'reviewer did not run: authentication failed';
      }
      Object.assign(result.totals, {
        caught: 0,
        total: 0,
        decoysClean: 0,
        decoysTotal: 0,
        falsePositives: 0,
        unverified: result.scenarios.length,
        recallPct: 0,
        precisionPct: 0,
      });
    });
    expect(() => readLatest(path)).toThrow(/scored no planted defect/);
  });

  it('refuses a run that scored no clean decoy', () => {
    // Precision over zero decoys is 100% by arithmetic, whatever the reviewer
    // did. The number has no content, so it is not published.
    const path = fixture((result) => {
      for (const s of result.scenarios.filter((s) => s.expected === 'clean')) {
        s.verdict = 'unverified';
        s.note = 'cost cap reached';
      }
      Object.assign(result.totals, {
        decoysClean: 0,
        decoysTotal: 0,
        falsePositives: 0,
        unverified: 6,
      });
    });
    expect(() => readLatest(path)).toThrow(/scored no clean decoy/);
  });

  it('refuses to publish a partial suite', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'benchmark-claims-')), 'latest.json');
    writeFileSync(path, JSON.stringify({ ...committed, config: { ...committed.config, suite: 'planted' } }));
    expect(() => readLatest(path)).toThrow(/partial suite/);
    // Control: the same file scoring the whole corpus reads fine, so the throw
    // is the subset and not the fixture.
    writeFileSync(path, JSON.stringify(committed));
    expect(() => readLatest(path)).not.toThrow();
  });

  it('renders every number from the result file', () => {
    const facts = benchmarkFacts(committed);
    const sentence = benchmarkSentence(facts);
    expect(sentence).toContain(`${facts.caught}/${facts.planted} planted defects`);
    expect(sentence).toContain(`${facts.recallPct}%`);
    expect(sentence).toContain(`${facts.falsePositives} of ${facts.decoys} clean decoys`);
    expect(sentence).toContain(facts.invocation);
    expect(sentence).toContain(facts.runDate);
  });

  it('changes what would be published when a scored number changes', () => {
    const mutated = JSON.parse(JSON.stringify(committed));
    mutated.totals.caught -= 1;
    const before = renderTargets(committed);
    const after = renderTargets(mutated);
    for (const path of [...MARKDOWN_TARGETS, SITE_CONST]) {
      expect(after.get(path), path).not.toBe(before.get(path));
    }
  });

  it('names the unverified remainder rather than reading as a full pass', () => {
    const stopped = JSON.parse(JSON.stringify(committed));
    stopped.totals.unverified = 3;
    expect(benchmarkSentence(benchmarkFacts(stopped))).toContain(
      '3 scenarios went unscored and are reported unverified, never clean',
    );
    expect(benchmarkSentence(benchmarkFacts(committed))).not.toContain('unverified');
  });

  it('carries the remainder as a clause the site blocks can render', () => {
    // The front page writes its own prose around these numbers rather than
    // printing the sentence, so the remainder has to be a fact it can render
    // like any other. A block that could only interpolate `caught`/`planted`
    // published "100% recall" for a run that reached 8 of 20 scenarios.
    const stopped = JSON.parse(JSON.stringify(committed));
    stopped.totals.unverified = 12;
    expect(benchmarkFacts(stopped).unverifiedClause).toContain('12 scenarios');
    expect(benchmarkFacts(stopped).unverifiedClause).toContain('unverified, never clean');
    // Empty on a full run: nothing to name, and a "0 unverified" clause is
    // noise every reader learns to skip.
    expect(benchmarkFacts(committed).unverifiedClause).toBe('');
  });

  it('names the corpus composition from the corpus, never from the scored sample', () => {
    // A cost-stopped run that reached three scenarios published "a committed
    // corpus of 20 scenarios — 2 planted defects ... plus 1 clean look-alikes":
    // the composition clause read `planted`/`decoys`, which are what the run
    // SCORED. The corpus holds fourteen and six whatever a run reaches.
    const stopped = JSON.parse(JSON.stringify(committed));
    const keep = new Set([
      stopped.scenarios.filter((s) => s.expected === 'finding').slice(0, 2).map((s) => s.id),
      stopped.scenarios.filter((s) => s.expected === 'clean').slice(0, 1).map((s) => s.id),
    ].flat());
    for (const s of stopped.scenarios) {
      if (keep.has(s.id)) continue;
      s.verdict = 'unverified';
      s.note = 'cost cap reached';
    }
    Object.assign(stopped.totals, derivedTotals(stopped.scenarios));

    const facts = benchmarkFacts(stopped);
    expect(facts.planted).toBe(2);
    expect(facts.decoys).toBe(1);
    expect(facts.corpusPlanted).toBe(committed.scenarios.filter((s) => s.expected === 'finding').length);
    expect(facts.corpusDecoys).toBe(committed.scenarios.filter((s) => s.expected === 'clean').length);
    // And the composition is the whole corpus, so the two halves add up to it.
    expect(facts.corpusPlanted + facts.corpusDecoys).toBe(facts.scenarios);
  });

  it('says so when the scoring recipe was not recorded', () => {
    const withRecipe = JSON.parse(JSON.stringify(committed));
    withRecipe.config.recipeSha256 = 'a'.repeat(64);
    expect(benchmarkFacts(withRecipe).caveat).toBe('');
    expect(benchmarkFacts(withRecipe).recipeSha).toBe('a'.repeat(12));
    expect(benchmarkFacts(committed).caveat).not.toBe('');
  });

  it('is idempotent — rendering the committed tree changes nothing', () => {
    for (const [path, content] of renderTargets(committed)) {
      expect(readFileSync(path, 'utf8'), path).toBe(content);
    }
  });
});

describe('check-benchmark-claims', () => {
  it('passes on the committed tree', () => {
    const res = spawnSync('node', [join(ROOT, 'scripts', 'check-benchmark-claims.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(res.status, `${res.stdout}\n${res.stderr}`).toBe(0);
  });

  it('finds no literal numeral, and a named remainder, in both site blocks', () => {
    expect(jsxBlockViolations()).toEqual([]);
  });

  it('fails a site block that publishes the ratio without the remainder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'benchmark-jsx-'));
    const write = (name, body) => {
      const path = join(dir, name);
      writeFileSync(
        path,
        `import { BENCHMARK } from '../lib/benchmark-score';\n` +
          `export default function P() {\n  return (\n    <p>\n      {/* BEGIN benchmark-score */}\n` +
          `      ${body}\n      {/* END benchmark-score */}\n    </p>\n  );\n}\n`,
      );
      return path;
    };
    const silent = write('silent.tsx', 'caught {BENCHMARK.caught} of {BENCHMARK.planted}');
    expect(jsxBlockViolations([silent]).join('\n')).toMatch(/remainder|unverified/);
    // Control: the same block naming the remainder passes, so the violation is
    // the missing clause and not the fixture.
    const named = write(
      'named.tsx',
      'caught {BENCHMARK.caught} of {BENCHMARK.planted}. {BENCHMARK.unverifiedClause}',
    );
    expect(jsxBlockViolations([named])).toEqual([]);
  });

  it('fails a site block that describes the committed corpus from the scored sample', () => {
    const dir = mkdtempSync(join(tmpdir(), 'benchmark-jsx-'));
    const write = (name, body) => {
      const path = join(dir, name);
      writeFileSync(
        path,
        `import { BENCHMARK } from '../lib/benchmark-score';\n` +
          `export default function P() {\n  return (\n    <p>\n      {/* BEGIN benchmark-score */}\n` +
          `      ${body}\n      {/* END benchmark-score */}\n    </p>\n  );\n}\n`,
      );
      return path;
    };
    const sample = write(
      'sample.tsx',
      'a committed corpus of {BENCHMARK.scenarios} scenarios, {BENCHMARK.planted} planted plus ' +
        '{BENCHMARK.decoys} decoys. {BENCHMARK.unverifiedClause}',
    );
    expect(jsxBlockViolations([sample]).join('\n')).toMatch(/composition/);
    // Control: the same clause read off the corpus fields passes, so the
    // violation is which fact it named and not the fixture.
    const corpus = write(
      'corpus.tsx',
      'a committed corpus of {BENCHMARK.scenarios} scenarios, {BENCHMARK.corpusPlanted} planted plus ' +
        '{BENCHMARK.corpusDecoys} decoys. {BENCHMARK.unverifiedClause}',
    );
    expect(jsxBlockViolations([corpus])).toEqual([]);
  });

  it('catches the same corpus-composition gap under a reworded phrase', () => {
    // The gate used to key on the literal phrase "committed corpus", so a
    // rewrite that dropped those two words while still rendering the corpus
    // size disarmed it silently. It has to key on the fact rendered
    // (`BENCHMARK.scenarios`) instead, or a rename is all it takes to publish
    // the composition gap this rule exists to catch.
    const dir = mkdtempSync(join(tmpdir(), 'benchmark-jsx-'));
    const write = (name, body) => {
      const path = join(dir, name);
      writeFileSync(
        path,
        `import { BENCHMARK } from '../lib/benchmark-score';\n` +
          `export default function P() {\n  return (\n    <p>\n      {/* BEGIN benchmark-score */}\n` +
          `      ${body}\n      {/* END benchmark-score */}\n    </p>\n  );\n}\n`,
      );
      return path;
    };
    const reworded = write(
      'reworded.tsx',
      'across a public benchmark of {BENCHMARK.scenarios} scenarios, {BENCHMARK.planted} planted plus ' +
        '{BENCHMARK.decoys} decoys. {BENCHMARK.unverifiedClause}',
    );
    expect(jsxBlockViolations([reworded]).join('\n')).toMatch(/composition/);
  });
});
