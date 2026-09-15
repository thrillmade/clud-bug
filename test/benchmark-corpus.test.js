// Corpus guard for the planted-defect benchmark (#270, SPEC 2.0 §8.2).
//
// The scorer is only as honest as the answer keys. `SCENARIO.md` is prose a
// human reads; `answer.json` is the machine-readable key the runner scores
// against, and the two must not drift. This pins the key's shape and its
// agreement with the SCENARIO.md frontmatter it was derived from.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCENARIOS = join(ROOT, 'benchmark', 'scenarios');

const dirs = readdirSync(SCENARIOS, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

// Frontmatter is the `---`-delimited YAML-ish head of SCENARIO.md. Only the
// two scalar fields this test compares are read, so a multi-line value below
// them cannot confuse the scan.
function scenarioField(md, field) {
  const m = md.match(new RegExp(`^${field}: (.*)$`, 'm'));
  return m ? m[1].trim() : null;
}

test('benchmark corpus: the committed scenario set is non-empty', () => {
  assert.ok(dirs.length >= 20, `expected >=20 scenarios, found ${dirs.length}`);
});

for (const id of dirs) {
  test(`benchmark corpus: ${id} has a well-formed answer.json`, () => {
    const dir = join(SCENARIOS, id);
    const keyPath = join(dir, 'answer.json');
    assert.ok(existsSync(keyPath), `${id}/answer.json is missing`);

    const key = JSON.parse(readFileSync(keyPath, 'utf8'));

    assert.equal(key.id, id, 'answer.json id must match its directory name');
    assert.ok(
      key.expected === 'finding' || key.expected === 'clean',
      `expected must be 'finding' | 'clean', got ${JSON.stringify(key.expected)}`,
    );
    assert.equal(typeof key.class, 'string');
    assert.ok(key.class.length > 0, 'class must be non-empty');

    assert.equal(typeof key.file, 'string');
    assert.ok(existsSync(join(dir, key.file)), `${id}: ${key.file} does not exist`);

    assert.ok(Array.isArray(key.lineRange), 'lineRange must be an array');
    assert.equal(key.lineRange.length, 2, 'lineRange must be [start, end]');
    const [lo, hi] = key.lineRange;
    assert.ok(Number.isInteger(lo) && lo >= 1, `lineRange start must be >=1, got ${lo}`);
    assert.ok(Number.isInteger(hi) && hi >= lo, `lineRange end must be >= start, got ${hi}`);
    const lines = readFileSync(join(dir, key.file), 'utf8').split('\n').length;
    assert.ok(hi <= lines, `${id}: lineRange end ${hi} is past EOF (${lines} lines)`);

    for (const alt of key.acceptAlso ?? []) {
      assert.equal(typeof alt.file, 'string');
      assert.ok(existsSync(join(dir, alt.file)), `${id}: acceptAlso ${alt.file} does not exist`);
      assert.ok(Array.isArray(alt.lineRange) && alt.lineRange.length === 2);
      const altLines = readFileSync(join(dir, alt.file), 'utf8').split('\n').length;
      assert.ok(alt.lineRange[0] >= 1 && alt.lineRange[1] <= altLines);
    }
  });

  test(`benchmark corpus: ${id} answer.json agrees with SCENARIO.md`, () => {
    const dir = join(SCENARIOS, id);
    const key = JSON.parse(readFileSync(join(dir, 'answer.json'), 'utf8'));
    const md = readFileSync(join(dir, 'SCENARIO.md'), 'utf8');

    assert.equal(key.class, scenarioField(md, 'class'), `${id}: class drifted`);
    assert.equal(key.severity, scenarioField(md, 'severity'), `${id}: severity drifted`);
    assert.equal(
      key.expected,
      scenarioField(md, 'class') === 'clean' ? 'clean' : 'finding',
      `${id}: expected must follow the SCENARIO.md class`,
    );
    // The key is withheld from reviewers, so SCENARIO.md is where a human
    // finds it — the link is the only thing that keeps the two discoverable
    // together.
    assert.ok(
      md.includes('answer.json'),
      `${id}: SCENARIO.md must link to its answer.json`,
    );
  });
}
