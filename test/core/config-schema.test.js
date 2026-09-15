// Tests for src/core/config-schema.ts — the single owner of what a setting
// is called, where it lives on disk, what it may hold, and who may write it
// (clud-bug#271 / SPEC 2.0 §1.6).
//
// §1.6:258 fixes the naming convention; §1.6:260 requires every named setting
// to be settable by a command; §1.6:262 names the settings an agent MUST NOT
// write; §1.6:243 requires an unrecognised key to round-trip unchanged.

import { describe, expect, it } from 'vitest';

import {
  CONFIG_KEYS,
  CONFIG_KEY_NAMES,
  HONEST_GUARANTEE,
  NOT_IN_SPEC,
  describeDomain,
  getAt,
  guardWrite,
  parseValueArg,
  resolveKey,
  setAt,
  stampSetting,
  unsetAt,
  validateValue,
} from '../../src/core/config-schema.js';

describe('CONFIG_KEYS', () => {
  // The mutation this pins: add a key to CONFIG_KEYS without a validator (or
  // without an owner / spec citation) and this goes red.
  it('every key carries a path, a validator, an owner and a SPEC citation', () => {
    expect(CONFIG_KEY_NAMES.length).toBeGreaterThan(0);
    for (const name of CONFIG_KEY_NAMES) {
      const def = CONFIG_KEYS[name];
      expect(Array.isArray(def?.path), `${name}.path`).toBe(true);
      expect(def.path.length, `${name}.path`).toBeGreaterThan(0);
      expect(typeof def.schema?.safeParse, `${name}.schema`).toBe('function');
      expect(['human', 'agent', 'tool'], `${name}.owner`).toContain(def.owner);
      // `null` is the one alternative to a section number, and the test below
      // pins exactly which keys may use it — a key that simply forgot `spec`
      // is `undefined` and still fails here.
      if (def.spec !== null) expect(def.spec, `${name}.spec`).toMatch(/^§\d+\.\d+$/);
      expect(typeof def.summary, `${name}.summary`).toBe('string');
      expect(def.summary.length, `${name}.summary`).toBeGreaterThan(0);
      expect(typeof def.domain, `${name}.domain`).toBe('string');
      expect(def.domain.length, `${name}.domain`).toBeGreaterThan(0);
    }
  });

  // §1.6:258 — "Keys are `snake_case`, and a dot means a nested object rather
  // than a literal dotted name."
  it('every key name is snake_case segments joined by dots', () => {
    for (const name of CONFIG_KEY_NAMES) {
      expect(name, name).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/);
    }
  });

  it('carries the five settings SPEC §1.6 names, at the on-disk paths this tool uses', () => {
    expect(CONFIG_KEYS['review.strict_mode'].path).toEqual(['strictMode']);
    expect(CONFIG_KEYS['review.ci_checks'].path).toEqual(['ciChecks']);
    expect(CONFIG_KEYS['review.trigger'].path).toEqual(['reviewTrigger']);
    expect(CONFIG_KEYS['review.auto_fix'].path).toEqual(['autoFix']);
    expect(CONFIG_KEYS['review.passes'].path).toEqual(['reviewPasses']);
    expect(CONFIG_KEYS['tests'].path).toEqual(['tests']);
  });

  // §1.6's own table cites the section that GOVERNS each setting, not §1.6
  // itself (`review.strict_mode` → §6.2, `review.auto_fix` → §4.6, etc.) — a
  // citation `specLabel` prints so a reader lands on the text that describes
  // the behaviour, not back on the config section they are already reading.
  it('cites the governing section the §1.6 table names, not §1.6 itself', () => {
    expect(CONFIG_KEYS['review.strict_mode'].spec).toBe('§6.2');
    expect(CONFIG_KEYS['review.ci_checks'].spec).toBe('§4.7');
    expect(CONFIG_KEYS['review.trigger'].spec).toBe('§4.1');
    expect(CONFIG_KEYS['review.auto_fix'].spec).toBe('§4.6');
    expect(CONFIG_KEYS['review.passes'].spec).toBe('§2.2');
  });

  // #271 ruling 1 — `review.auto_fix` is the §1.6:262/§4.6 setting SPEC's own
  // table names ("whether a reviewer may push a fix, and how many rounds"),
  // and MUST be settable + humans-only under that exact name even though only
  // the hosted App reads it. `review.auto_resolve` is a DIFFERENT setting —
  // the one OSS actually implements (deciding whether a prior thread was
  // addressed) — and is not on §1.6:262's humans-only list.
  it('review.auto_fix names the §4.6 push-a-fix mechanism, disclosing that only the hosted App reads it', () => {
    const def = CONFIG_KEYS['review.auto_fix'];
    expect(def.path).toEqual(['autoFix']);
    expect(def.owner).toBe('human');
    expect(def.summary).toMatch(/push a fix/);
    expect(def.summary.toLowerCase()).toContain('hosted app');
  });

  it('review.auto_resolve is the §4.3 thread-resolution setting OSS actually implements — never §4.6', () => {
    const def = CONFIG_KEYS['review.auto_resolve'];
    expect(def.path).toEqual(['autoResolve']);
    expect(def.spec).toBe('§4.3');
    expect(def.owner).toBe('agent');
    expect(def.summary).not.toMatch(/push a fix/);
  });

  // §1.6:262 + §4.8. This list is the whole point of the issue; a key silently
  // losing `owner: 'human'` is the regression that matters.
  it('marks exactly the blocking settings human-owned', () => {
    const human = CONFIG_KEY_NAMES.filter((k) => CONFIG_KEYS[k].owner === 'human').sort();
    expect(human).toEqual([
      'design.gate',
      'review.auto_fix',
      'review.passes.blocking',
      'review.strict_mode',
      'review.strict_skills',
    ]);
  });

  // A citation a reader can go and check is worse than none when it turns out
  // to be unrelated: these three name mechanisms SPEC 2.0 never describes.
  // `git show origin/main:SPEC.md | grep -c pin_version` → 0, against a
  // control (`review.strict_mode`) that finds 4.
  it('names the settings SPEC 2.0 does not cover, instead of citing a section that is not about them', () => {
    const uncited = CONFIG_KEY_NAMES.filter((k) => CONFIG_KEYS[k].spec === null).sort();
    expect(uncited).toEqual(['excluded_baselines', 'pin_version', 'review.strict_skills']);
    expect(NOT_IN_SPEC).toMatch(/SPEC 2\.0/);
    expect(NOT_IN_SPEC).not.toMatch(/§/);
  });

  it('no two keys share an on-disk path', () => {
    const seen = new Map();
    for (const name of CONFIG_KEY_NAMES) {
      const path = CONFIG_KEYS[name].path.join('.');
      expect(seen.get(path), `${name} collides with ${seen.get(path)}`).toBeUndefined();
      seen.set(path, name);
    }
  });
});

describe('resolveKey', () => {
  it('resolves an exact key', () => {
    const r = resolveKey('review.strict_mode');
    expect(r.ok).toBe(true);
    expect(r.name).toBe('review.strict_mode');
    expect(r.def.path).toEqual(['strictMode']);
  });

  it('does not resolve the on-disk spelling — the command speaks SPEC names', () => {
    expect(resolveKey('strictMode').ok).toBe(false);
  });

  // SPEC.md:825 (§4.1) names this setting exactly once — `review_context`,
  // with no dot — and §1.6:258 makes a dot mean a nested object rather than a
  // literal dotted name, so `review.context` is a different name, not a
  // spelling of it. The on-disk key is untouched: the App reads `reviewContext`
  // in customer repositories.
  it('uses the name SPEC gives review_context, over the on-disk spelling', () => {
    const r = resolveKey('review_context');
    expect(r.ok).toBe(true);
    expect(CONFIG_KEYS['review_context'].path).toEqual(['reviewContext']);
    expect(CONFIG_KEYS['review.context']).toBeUndefined();
    expect(resolveKey('review.context')).toMatchObject({ ok: false, suggestion: 'review_context' });
  });

  it('offers a did-you-mean for a near miss', () => {
    expect(resolveKey('review.strictmode')).toMatchObject({ ok: false, suggestion: 'review.strict_mode' });
    expect(resolveKey('review.ci_check')).toMatchObject({ ok: false, suggestion: 'review.ci_checks' });
    expect(resolveKey('design.gait')).toMatchObject({ ok: false, suggestion: 'design.gate' });
  });

  it('offers no suggestion when nothing is close', () => {
    const r = resolveKey('completely_unrelated_thing');
    expect(r.ok).toBe(false);
    expect(r.suggestion).toBeUndefined();
  });
});

describe('validateValue', () => {
  it('accepts a value in the domain', () => {
    expect(validateValue('review.strict_mode', true)).toEqual({ ok: true, value: true });
    expect(validateValue('review.ci_checks', ['build'])).toEqual({ ok: true, value: ['build'] });
    expect(validateValue('tests', 'npm test')).toEqual({ ok: true, value: 'npm test' });
  });

  // §1.6:260 — "refusing a value the setting cannot take and saying what it can".
  it('refuses a value outside the domain and says what the setting can take', () => {
    const r = validateValue('review.strict_mode', 'yes');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('review.strict_mode');
    expect(r.message).toContain(describeDomain('review.strict_mode'));
  });

  it('refuses a trigger outside the enumerated set, naming the set', () => {
    const r = validateValue('review.trigger', 'nightly');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('commit');
    expect(r.message).toContain('push');
  });

  it('accepts an explicit empty ci_checks list — the §4.7 full opt-out', () => {
    expect(validateValue('review.ci_checks', [])).toEqual({ ok: true, value: [] });
  });

  // #271 ruling 4 — the cap `review-context.ts`'s own reader silently
  // truncates to; `set` must refuse it instead, or a value nobody reviews
  // with in full would round-trip through `get`/`list` as if it were kept.
  describe('review_context byte cap', () => {
    it('accepts a string at exactly 4096 bytes', () => {
      const atCap = 'x'.repeat(4096);
      expect(validateValue('review_context', atCap)).toEqual({ ok: true, value: atCap });
    });

    it('refuses a string one byte over the cap, naming it', () => {
      const overCap = 'x'.repeat(4097);
      const r = validateValue('review_context', overCap);
      expect(r.ok).toBe(false);
      expect(r.message).toContain('4096 bytes');
    });

    it('accepts {"instructions":…} at exactly 4096 bytes', () => {
      const atCap = { instructions: 'x'.repeat(4096) };
      expect(validateValue('review_context', atCap)).toEqual({ ok: true, value: atCap });
    });

    it('refuses {"instructions":…} one byte over the cap', () => {
      const overCap = { instructions: 'x'.repeat(4097) };
      const r = validateValue('review_context', overCap);
      expect(r.ok).toBe(false);
      expect(r.message).toContain('4096 bytes');
    });
  });
});

describe('parseValueArg', () => {
  it('reads JSON when the argument is JSON', () => {
    expect(parseValueArg('true')).toBe(true);
    expect(parseValueArg('3.5')).toBe(3.5);
    expect(parseValueArg('["build","test"]')).toEqual(['build', 'test']);
    expect(parseValueArg('{"count":2}')).toEqual({ count: 2 });
  });

  it('reads anything else as the literal string a shell would pass', () => {
    expect(parseValueArg('npm test')).toBe('npm test');
    expect(parseValueArg('none')).toBe('none');
    expect(parseValueArg('advisory')).toBe('advisory');
  });
});

describe('getAt / setAt / unsetAt', () => {
  const manifest = {
    version: 1,
    installed: [{ slug: 'a' }],
    somethingNobodyHereKnows: { deep: [1, 2, { three: true }] },
    design: { enabled: true, gate: 'advisory', futureKnob: 'keep me' },
  };

  it('reads a nested path', () => {
    expect(getAt(manifest, ['design', 'gate'])).toBe('advisory');
    expect(getAt(manifest, ['design', 'missing'])).toBeUndefined();
    expect(getAt(manifest, ['nope', 'deeper'])).toBeUndefined();
  });

  // §1.6:243 — "An unrecognised key MUST NOT cause a failure, and any tool
  // that rewrites the file MUST round-trip that key unchanged."
  it('setAt preserves unknown siblings byte-identically', () => {
    const before = JSON.stringify(manifest, null, 2);
    const next = setAt(manifest, ['design', 'enabled'], false);
    expect(JSON.stringify(manifest, null, 2)).toBe(before); // input untouched
    expect(next.somethingNobodyHereKnows).toEqual(manifest.somethingNobodyHereKnows);
    expect(next.design.futureKnob).toBe('keep me');
    const rendered = JSON.stringify(next, null, 2);
    expect(rendered).toBe(before.replace('"enabled": true', '"enabled": false'));
  });

  it('setAt creates missing intermediate objects', () => {
    const next = setAt({ version: 1 }, ['reviewPasses', 'default', 'count'], 2);
    expect(next).toEqual({ version: 1, reviewPasses: { default: { count: 2 } } });
  });

  it('unsetAt removes the key and leaves every sibling in place', () => {
    const next = unsetAt(manifest, ['design', 'enabled']);
    expect('enabled' in next.design).toBe(false);
    expect(next.design).toEqual({ gate: 'advisory', futureKnob: 'keep me' });
    expect(next.somethingNobodyHereKnows).toEqual(manifest.somethingNobodyHereKnows);
  });

  it('unsetAt on an absent path is a no-op, not an error', () => {
    expect(unsetAt({ version: 1 }, ['design', 'gate'])).toEqual({ version: 1 });
  });
});

describe('guardWrite', () => {
  // §1.6:262 — "`review.strict_mode`, `git.enforce_commits` and
  // `review.auto_fix` MUST NOT be written by an agent — not through the
  // command, not by editing the file."
  it('refuses a human-owned key, citing the SPEC section and naming the human path', () => {
    const r = guardWrite({ key: 'review.strict_mode', nextValue: false, manifest: {}, writer: 'command' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('review.strict_mode');
    expect(r.message).toContain('§1.6');
    expect(r.message).toContain('.claude/skills/.clud-bug.json');
  });

  // The quoted sentence lives in §1.6 and nowhere else (SPEC.md:262). Every
  // refusal that quotes it says so, whatever section governs the setting —
  // attributing it to §4.8 or §6.2 sends a reader to text that does not
  // contain it.
  it('attributes the quoted rule to §1.6 for every humans-only key', () => {
    const human = CONFIG_KEY_NAMES.filter((k) => CONFIG_KEYS[k].owner === 'human');
    expect(human.length).toBeGreaterThan(0);
    for (const name of human) {
      const r = guardWrite({ key: name, nextValue: null, manifest: {}, writer: 'command' });
      expect(r.ok, name).toBe(false);
      expect(r.message, name).toContain("SPEC §1.6 keeps that a person's to change");
    }
  });

  it('refuses an unset of a human-owned key — absence is a weakening too', () => {
    expect(guardWrite({
      key: 'design.gate', manifest: { design: { gate: 'strict' } }, writer: 'command',
    }).ok).toBe(false);
  });

  it('allows every agent-owned key', () => {
    expect(guardWrite({ key: 'review.ci_checks', nextValue: [], manifest: {}, writer: 'command' }).ok).toBe(true);
    expect(guardWrite({ key: 'tests', nextValue: 'npm test', manifest: {}, writer: 'command' }).ok).toBe(true);
    expect(guardWrite({ key: 'design.enabled', nextValue: true, manifest: {}, writer: 'command' }).ok).toBe(true);
  });

  it('refuses a tool-owned key, and says so differently from a human-owned one', () => {
    const r = guardWrite({ key: 'installed', nextValue: [], manifest: {}, writer: 'command' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('clud-bug');
    expect(r.message).not.toContain('§1.6:262');
  });

  // The whole-block write is the interesting hole: `set review.passes {...}`
  // replaces the object, so an omitted `blocking` would delete a human-owned
  // value without ever naming it.
  it('refuses an ancestor write that would drop an existing human-owned descendant', () => {
    const manifest = { reviewPasses: { count: 2, blocking: ['design'] } };
    const r = guardWrite({ key: 'review.passes', nextValue: { count: 3 }, manifest, writer: 'command' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('review.passes.blocking');
  });

  it('refuses an ancestor write that would change an existing human-owned descendant', () => {
    const manifest = { reviewPasses: { blocking: [] } };
    const r = guardWrite({
      key: 'review.passes',
      nextValue: { blocking: ['design'] },
      manifest,
      writer: 'command',
    });
    expect(r.ok).toBe(false);
  });

  it('allows an ancestor write that carries the human-owned descendant through unchanged', () => {
    const manifest = { reviewPasses: { count: 2, blocking: ['design'] } };
    const r = guardWrite({
      key: 'review.passes',
      nextValue: { count: 3, blocking: ['design'] },
      manifest,
      writer: 'command',
    });
    expect(r.ok).toBe(true);
  });

  it('allows an ancestor write when the file has no human-owned descendant to lose', () => {
    const r = guardWrite({ key: 'review.passes', nextValue: { count: 3 }, manifest: {}, writer: 'command' });
    expect(r.ok).toBe(true);
  });

  it('refuses an unset of an ancestor holding a human-owned descendant', () => {
    const manifest = { reviewPasses: { blocking: ['design'] } };
    expect(guardWrite({ key: 'review.passes', manifest, writer: 'command' }).ok).toBe(false);
  });
});

// The gate `init` goes through is this same one — not a condition a call site
// in main.ts remembers. Before #271's round 2, `stampSetting` validated the
// VALUE and never looked at the owner at all: the only thing standing between
// `init` and a humans-only key was the hand-written `if` above its one such
// call, and the header of this module claimed otherwise.
describe('guardWrite — writer: setup', () => {
  it('lets setup maintain the tool-owned state the command refuses', () => {
    expect(guardWrite({ key: 'installed', nextValue: [], manifest: {}, writer: 'setup' }).ok).toBe(true);
    expect(guardWrite({ key: 'last_update', nextValue: 'now', manifest: {}, writer: 'setup' }).ok).toBe(true);
    // …and the command still does not get to touch it.
    expect(guardWrite({ key: 'installed', nextValue: [], manifest: {}, writer: 'command' }).ok).toBe(false);
  });

  it('lets setup CREATE review.strict_mode at the value the schema declares', () => {
    expect(CONFIG_KEYS['review.strict_mode'].setupDefault).toBe(true);
    const r = guardWrite({ key: 'review.strict_mode', nextValue: true, manifest: {}, writer: 'setup' });
    expect(r.ok).toBe(true);
  });

  it('refuses setup the weaker value, however fresh the install looks', () => {
    const r = guardWrite({ key: 'review.strict_mode', nextValue: false, manifest: {}, writer: 'setup' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("SPEC §1.6 keeps that a person's to change");
  });

  it('refuses setup a write over a value that is already there', () => {
    const manifest = { strictMode: false };
    expect(guardWrite({ key: 'review.strict_mode', nextValue: true, manifest, writer: 'setup' }).ok).toBe(false);
  });

  it('refuses setup every human-owned key the schema gives no setup value', () => {
    const human = CONFIG_KEY_NAMES.filter(
      (k) => CONFIG_KEYS[k].owner === 'human' && CONFIG_KEYS[k].setupDefault === undefined,
    );
    expect(human.length).toBeGreaterThan(0);
    for (const name of human) {
      const r = guardWrite({ key: name, nextValue: [], manifest: {}, writer: 'setup' });
      expect(r.ok, name).toBe(false);
    }
  });

  it('refuses setup an unset of a human-owned key', () => {
    expect(guardWrite({ key: 'review.strict_mode', manifest: {}, writer: 'setup' }).ok).toBe(false);
  });
});

describe('stampSetting', () => {
  it('writes an agent-owned setting at the schema’s path, validated', () => {
    expect(stampSetting({ version: 1 }, 'design.enabled', true)).toEqual({
      version: 1, design: { enabled: true },
    });
    expect(stampSetting({}, 'tests', '  npm test  ')).toEqual({ tests: 'npm test' });
  });

  it('creates review.strict_mode on a manifest that has none', () => {
    expect(stampSetting({}, 'review.strict_mode', true)).toEqual({ strictMode: true });
  });

  it('throws rather than weakening review.strict_mode', () => {
    expect(() => stampSetting({}, 'review.strict_mode', false)).toThrow(/refusing to set review\.strict_mode/);
    expect(() => stampSetting({ strictMode: true }, 'review.strict_mode', true)).toThrow(/review\.strict_mode/);
  });

  it('throws rather than writing a value the setting cannot take', () => {
    expect(() => stampSetting({}, 'review.trigger', 'nightly')).toThrow(/commit, push, or both/);
  });

  it('throws on a key the schema does not have, rather than inventing a path', () => {
    expect(() => stampSetting({}, 'not_a_setting', 1)).toThrow(/not a clud-bug setting/);
  });
});

describe('HONEST_GUARANTEE', () => {
  // §1.6:266 — the two things that hold even when the rule is broken. The
  // refusal above stops a tool that asks and nothing else; every surface that
  // quotes it quotes this one string.
  it('claims only the base-ref read and the diff, never enforcement', () => {
    expect(HONEST_GUARANTEE).toContain('base ref');
    expect(HONEST_GUARANTEE).toMatch(/hunk in a diff/);
    expect(HONEST_GUARANTEE).toMatch(/asks/);
  });
});
