import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SkillsClient, rankAndCap, writeSkills, loadBaseline,
  readManifest, writeManifest, mergeManifest,
  removeSkill, listInstalled, diffManifest,
  readReviewMode, partitionByReviewMode,
  extractPerSkillLine, classifyPerSkillOutcome,
  selectReviewHeader, extractFirstReviewHeaderLine, isCriticalReviewHeader,
  selectReviewBody,
  _internal,
} from '../lib/skills.js';

function mockFetch(routes) {
  return async (url) => {
    const path = url.replace(_internal.API_BASE, '');
    if (!(path in routes)) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    const body = routes[path];
    return { ok: true, status: 200, json: async () => body };
  };
}

test('SkillsClient.search returns normalized results from { skills: [...] } shape', async () => {
  const client = new SkillsClient({
    fetch: mockFetch({
      '/skills/search?q=nextjs%20react': {
        skills: [
          { source: 'foo/bar', name: 'next-best-practices', description: 'd1', installs: 50 },
          { source: 'baz/qux', name: 'react-hooks', description: 'd2', installs: 10 },
        ],
      },
    }),
  });
  const out = await client.search(['nextjs', 'react']);
  assert.equal(out.length, 2);
  assert.equal(out[0].source, 'foo/bar');
});

test('SkillsClient.search returns normalized results from bare array shape', async () => {
  const client = new SkillsClient({
    fetch: mockFetch({
      '/skills/search?q=python': [
        { source: 's/n', name: 'fastapi-patterns', summary: 'sum', installCount: 7 },
      ],
    }),
  });
  const out = await client.search(['python']);
  assert.equal(out[0].description, 'sum');
  assert.equal(out[0].installs, 7);
});

test('SkillsClient.search short-circuits on empty terms', async () => {
  const client = new SkillsClient({ fetch: () => { throw new Error('should not fetch'); } });
  const out = await client.search([]);
  assert.deepEqual(out, []);
});

test('SkillsClient.getContent prefers content, falls back to body, then files[0].content', async () => {
  const c1 = new SkillsClient({ fetch: mockFetch({ '/skills/a/b': { content: 'C' } }) });
  assert.equal(await c1.getContent('a', 'b'), 'C');
  const c2 = new SkillsClient({ fetch: mockFetch({ '/skills/a/b': { body: 'B' } }) });
  assert.equal(await c2.getContent('a', 'b'), 'B');
  const c3 = new SkillsClient({ fetch: mockFetch({ '/skills/a/b': { files: [{ content: 'F' }] } }) });
  assert.equal(await c3.getContent('a', 'b'), 'F');
});

test('SkillsClient.getContent throws if no content field present', async () => {
  const client = new SkillsClient({ fetch: mockFetch({ '/skills/a/b': { other: 'x' } }) });
  await assert.rejects(client.getContent('a', 'b'), /no content field/);
});

test('SkillsClient.json throws on non-2xx', async () => {
  const client = new SkillsClient({ fetch: mockFetch({}) });
  await assert.rejects(client.search(['x']), /404/);
});

test('rankAndCap places baseline first, dedupes, caps at limit', () => {
  const baseline = [
    { source: 'clud-bug-baseline', name: 'critical-issues-only', kind: 'baseline' },
  ];
  const curated = [
    { source: 'anthropic/skills', name: 'security-review', installs: 1000 },
  ];
  const searched = [
    { source: 'foo/bar', name: 'nextjs', installs: 500 },
    { source: 'foo/bar', name: 'nextjs', installs: 500 },
    { source: 'baz/qux', name: 'react', installs: 100 },
  ];
  const out = rankAndCap(curated, searched, baseline, 3);
  assert.equal(out.length, 3);
  assert.equal(out[0].name, 'critical-issues-only');
  assert.equal(out[1].name, 'security-review');
  assert.equal(out[2].name, 'nextjs');
});

test('writeSkills creates SKILL.md per skill in nested directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-skills-'));
  try {
    const client = new SkillsClient({
      fetch: mockFetch({ '/skills/foo/bar': { content: 'remote skill body' } }),
    });
    const skills = [
      { source: 'foo', name: 'bar', kind: 'remote' },
      { source: 'clud-bug-baseline', name: 'local-skill', kind: 'baseline', content: 'local body' },
    ];
    const written = await writeSkills(dir, skills, client);
    assert.equal(written.length, 2);
    assert.equal(await readFile(join(dir, 'bar', 'SKILL.md'), 'utf8'), 'remote skill body');
    assert.equal(await readFile(join(dir, 'local-skill', 'SKILL.md'), 'utf8'), 'local body');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Tests pass cacheDir: null + a stub fetch so they don't touch the user's
// real cache dir or hit the live agent-skills repo.
const offlineOpts = { cacheDir: null, fetch: async () => { throw new Error('test: no network'); } };

test('loadBaseline reads .md files from a directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-baseline-'));
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'a.md'), 'A');
    await writeFile(join(dir, 'b.md'), 'B');
    await writeFile(join(dir, 'ignore.txt'), 'no');
    const out = await loadBaseline(dir, offlineOpts);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map(s => s.name).sort(), ['a', 'b']);
    // Stub fetch threw → all should report _source: 'bundled'
    assert.ok(out.every((s) => s._source === 'bundled'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadBaseline returns empty if directory missing', async () => {
  const out = await loadBaseline('/tmp/clud-bug-does-not-exist-' + Date.now(), offlineOpts);
  assert.deepEqual(out, []);
});

test('loadBaseline: prefers remote (agent-skills) when fetch succeeds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-baseline-fetch-'));
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'critical-issues-only.md'), 'BUNDLED CONTENT');

    let fetchedUrl;
    const fetch = async (url) => {
      fetchedUrl = url;
      return { ok: true, status: 200, text: async () => 'REMOTE CONTENT' };
    };
    const out = await loadBaseline(dir, { cacheDir: null, fetch });
    assert.equal(out.length, 1);
    assert.equal(out[0].content, 'REMOTE CONTENT');
    assert.equal(out[0]._source, 'agent-skills');
    // Pinned to a SHA, not main — re-couples trust to clud-bug releases.
    assert.match(fetchedUrl, /thrillmot\/agent-skills\/[0-9a-f]{40}\/skills\/critical-issues-only\/SKILL\.md/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadBaseline: falls back to bundled on 404', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-baseline-404-'));
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'x.md'), 'BUNDLED FALLBACK');
    const fetch = async () => ({ ok: false, status: 404, text: async () => '' });
    const out = await loadBaseline(dir, { cacheDir: null, fetch });
    assert.equal(out[0].content, 'BUNDLED FALLBACK');
    assert.equal(out[0]._source, 'bundled');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadBaseline: falls back to bundled on network error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-baseline-neterr-'));
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'y.md'), 'BUNDLED ON ERROR');
    const fetch = async () => { throw new Error('ENOTFOUND'); };
    const out = await loadBaseline(dir, { cacheDir: null, fetch });
    assert.equal(out[0].content, 'BUNDLED ON ERROR');
    assert.equal(out[0]._source, 'bundled');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadBaseline: falls back to bundled on empty remote body', async () => {
  // A 200 with empty body shouldn't be treated as a valid skill.
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-baseline-empty-'));
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'z.md'), 'BUNDLED ON EMPTY');
    const fetch = async () => ({ ok: true, status: 200, text: async () => '' });
    const out = await loadBaseline(dir, { cacheDir: null, fetch });
    assert.equal(out[0].content, 'BUNDLED ON EMPTY');
    assert.equal(out[0]._source, 'bundled');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadBaseline: cache key differs by upstream base — switching bases re-fetches', async () => {
  // If the cache key ignored the base URL, a user who set
  // CLUD_BUG_AGENT_SKILLS_BASE to a fork and then unset it would silently
  // get the fork's content from cache. Cache keys must include the base.
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-baseline-base-'));
  const cache = await mkdtemp(join(tmpdir(), 'clud-bug-baseline-base-cache-'));
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'shared-name.md'), 'BUNDLED');
    let calls = 0;
    const fetch = async (url) => {
      calls++;
      return { ok: true, status: 200, text: async () => `REMOTE-FROM-${url}` };
    };
    const originalBase = process.env.CLUD_BUG_AGENT_SKILLS_BASE;
    try {
      process.env.CLUD_BUG_AGENT_SKILLS_BASE = 'https://fork-a.example/skills';
      // Force re-import to pick up the env-driven AGENT_SKILLS_BASE.
      // (Tests use fresh import via dynamic specifier with cache-buster.)
      const modA = await import('../lib/skills.js?base-a');
      await modA.loadBaseline(dir, { cacheDir: cache, fetch });
      assert.equal(calls, 1, 'first base: 1 fetch');

      process.env.CLUD_BUG_AGENT_SKILLS_BASE = 'https://fork-b.example/skills';
      const modB = await import('../lib/skills.js?base-b');
      await modB.loadBaseline(dir, { cacheDir: cache, fetch });
      assert.equal(calls, 2, 'second base: cache key differs, must re-fetch');
    } finally {
      if (originalBase === undefined) delete process.env.CLUD_BUG_AGENT_SKILLS_BASE;
      else process.env.CLUD_BUG_AGENT_SKILLS_BASE = originalBase;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
  }
});

test('loadBaseline: cache hit avoids network on second call', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-baseline-cache-src-'));
  const cache = await mkdtemp(join(tmpdir(), 'clud-bug-baseline-cache-dst-'));
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'cached.md'), 'BUNDLED');
    let fetchCount = 0;
    const fetch = async () => {
      fetchCount++;
      return { ok: true, status: 200, text: async () => 'REMOTE-VIA-CACHE' };
    };
    // First call: warms the cache.
    await loadBaseline(dir, { cacheDir: cache, fetch });
    assert.equal(fetchCount, 1);
    // Second call: should hit the cache, not the network.
    const out = await loadBaseline(dir, { cacheDir: cache, fetch });
    assert.equal(fetchCount, 1, 'second call must not fetch');
    assert.equal(out[0].content, 'REMOTE-VIA-CACHE');
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
  }
});

test('sanitizeSlug normalizes names safely', () => {
  assert.equal(_internal.sanitizeSlug('Foo Bar!'), 'foo-bar');
  assert.equal(_internal.sanitizeSlug('--Already-OK--'), 'already-ok');
});

test('writeSkills creates a manifest tracking what it installed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-manifest-'));
  try {
    const client = new SkillsClient({
      fetch: mockFetch({ '/skills/foo/bar': { content: 'remote body' } }),
    });
    await writeSkills(dir, [
      { source: 'foo', name: 'bar', kind: 'remote' },
      { source: 'clud-bug-baseline', name: 'baseline-skill', kind: 'baseline', content: 'b' },
    ], client);
    const manifest = await readManifest(dir);
    assert.equal(manifest.installed.length, 2);
    const baseline = manifest.installed.find(e => e.kind === 'baseline');
    const remote = manifest.installed.find(e => e.kind === 'remote');
    assert.equal(baseline.slug, 'baseline-skill');
    assert.equal(remote.slug, 'bar');
    assert.equal(remote.source, 'foo');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('readManifest returns empty when file missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-empty-'));
  try {
    const m = await readManifest(dir);
    assert.equal(m.installed.length, 0);
    assert.equal(m.version, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('mergeManifest replaces by key, never duplicates', () => {
  const existing = { installed: [
    { slug: 'a', source: 'x', name: 'a', kind: 'remote' },
    { slug: 'baseline-thing', kind: 'baseline' },
  ]};
  const merged = mergeManifest(existing, [
    { slug: 'a', source: 'x', name: 'a', kind: 'remote', description: 'updated' },
    { slug: 'b', source: 'y', name: 'b', kind: 'remote' },
  ]);
  assert.equal(merged.installed.length, 3);
  assert.equal(merged.installed.find(e => e.slug === 'a').description, 'updated');
});

test('writeSkills called twice merges manifests instead of overwriting', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-merge-'));
  try {
    const client = new SkillsClient({ fetch: mockFetch({
      '/skills/a/x': { content: 'A' },
      '/skills/b/y': { content: 'B' },
    })});
    await writeSkills(dir, [{ source: 'a', name: 'x', kind: 'remote' }], client);
    await writeSkills(dir, [{ source: 'b', name: 'y', kind: 'remote' }], client);
    const m = await readManifest(dir);
    const slugs = m.installed.map(e => e.slug).sort();
    assert.deepEqual(slugs, ['x', 'y']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('removeSkill deletes dir and manifest entry; refuses non-managed slug', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-remove-'));
  try {
    const client = new SkillsClient({ fetch: mockFetch({ '/skills/x/y': { content: 'C' } })});
    await writeSkills(dir, [{ source: 'x', name: 'y', kind: 'remote' }], client);
    await removeSkill(dir, 'y');
    const m = await readManifest(dir);
    assert.equal(m.installed.length, 0);
    await assert.rejects(removeSkill(dir, 'never-installed'), /not in the clud-bug manifest/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('listInstalled groups baseline / remote / custom correctly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-list-'));
  try {
    const client = new SkillsClient({ fetch: mockFetch({ '/skills/foo/bar': { content: 'r' } })});
    await writeSkills(dir, [
      { source: 'foo', name: 'bar', kind: 'remote', description: 'remote desc' },
      { source: 'clud-bug-baseline', name: 'discipline', kind: 'baseline', content: '---\nname: discipline\ndescription: rules\n---', description: '(bundled baseline)' },
    ], client);
    // hand-author a custom skill
    const customDir = join(dir, 'my-custom');
    await mkdir(customDir, { recursive: true });
    await writeFile(join(customDir, 'SKILL.md'), '---\nname: my-custom\ndescription: my team rules\n---\n# rules');

    const groups = await listInstalled(dir);
    assert.equal(groups.baseline.length, 1);
    assert.equal(groups.remote.length, 1);
    assert.equal(groups.custom.length, 1);
    assert.equal(groups.custom[0].slug, 'my-custom');
    assert.equal(groups.custom[0].description, 'my team rules');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('diffManifest produces add/remove/unchanged buckets and ignores baseline removal', () => {
  const manifest = { installed: [
    { slug: 'a', source: 'x', name: 'a', kind: 'remote' },
    { slug: 'b', source: 'y', name: 'b', kind: 'remote' },
    { slug: 'baseline-1', kind: 'baseline' },
  ]};
  const recommended = [
    { source: 'x', name: 'a', kind: 'remote' },     // unchanged
    { source: 'z', name: 'c', kind: 'remote' },     // new add
  ];
  const diff = diffManifest(manifest, recommended);
  assert.equal(diff.unchanged.length, 1);
  assert.equal(diff.add.length, 1);
  assert.equal(diff.add[0].name, 'c');
  assert.equal(diff.remove.length, 1);
  assert.equal(diff.remove[0].slug, 'b');  // baseline-1 not removed
});

test('writeSkill (single) writes one SKILL.md without touching manifest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-single-'));
  try {
    const client = new SkillsClient({ fetch: mockFetch({ '/skills/p/q': { content: 'single' } })});
    const { writeSkill } = await import('../lib/skills.js');
    const entry = await writeSkill(dir, { source: 'p', name: 'q', kind: 'remote' }, client);
    assert.equal(entry.slug, 'q');
    assert.equal(await readFile(join(dir, 'q', 'SKILL.md'), 'utf8'), 'single');
    // No manifest written by writeSkill alone
    const m = await readManifest(dir);
    assert.equal(m.installed.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('manifest extra fields (pinVersion, lastUpdate*) survive writeSkills + mergeManifest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-pin-survive-'));
  try {
    // Pre-seed manifest with extension fields a user might have set.
    await writeManifest(dir, {
      version: 1,
      installed: [{ slug: 'a', source: 'x', name: 'a', kind: 'remote' }],
      pinVersion: '0.3.0',
      lastUpdate: '2026-05-01T00:00:00Z',
      lastUpdateVersion: '0.3.0',
    });

    // writeSkills (which goes through mergeManifest) must not strip extras.
    const client = new SkillsClient({
      fetch: mockFetch({ '/skills/y/z': { content: 'new' } }),
    });
    await writeSkills(dir, [{ source: 'y', name: 'z', kind: 'remote' }], client);

    const after = await readManifest(dir);
    assert.equal(after.pinVersion, '0.3.0', 'pinVersion must survive writeSkills');
    assert.equal(after.lastUpdate, '2026-05-01T00:00:00Z');
    assert.equal(after.lastUpdateVersion, '0.3.0');
    assert.ok(after.installed.find((e) => e.slug === 'z'));
    assert.ok(after.installed.find((e) => e.slug === 'a'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('readReviewMode: returns "shared" when frontmatter omits review_mode', () => {
  const content = '---\nname: foo\ndescription: bar\n---\n\n# Body\n';
  assert.equal(readReviewMode(content), 'shared');
});

test('readReviewMode: returns "dedicated" when frontmatter declares it', () => {
  const content = '---\nname: brand\ndescription: x\nreview_mode: dedicated\n---\n\n# Body\n';
  assert.equal(readReviewMode(content), 'dedicated');
});

test('readReviewMode: returns "shared" when review_mode appears only in body, not frontmatter', () => {
  // Defensive: a `review_mode: dedicated` line inside the body (documentation,
  // not configuration) must NOT be interpreted as the skill's mode. The parser
  // scopes its match to the frontmatter block between the first two `---` lines.
  const content = '---\nname: foo\ndescription: x\n---\n\nThe `review_mode: dedicated` field is documented here.\n';
  assert.equal(readReviewMode(content), 'shared');
});

test('readReviewMode: returns "shared" for unknown values (forward-compat)', () => {
  const content = '---\nname: foo\nreview_mode: experimental\n---\n';
  assert.equal(readReviewMode(content), 'shared');
});

test('readReviewMode: strips YAML string quotes around the value', () => {
  // YAML allows `review_mode: "dedicated"` and `review_mode: 'dedicated'`.
  // Both must resolve to dedicated; otherwise an author using either valid
  // YAML form gets silent shared-routing.
  for (const form of [
    '---\nname: x\nreview_mode: "dedicated"\n---\n',
    "---\nname: x\nreview_mode: 'dedicated'\n---\n",
  ]) {
    assert.equal(readReviewMode(form), 'dedicated', `quoted form: ${form.match(/review_mode:[^\n]+/)[0]}`);
  }
});

test('readReviewMode: returns "shared" on missing/empty/non-string input', () => {
  assert.equal(readReviewMode(null), 'shared');
  assert.equal(readReviewMode(undefined), 'shared');
  assert.equal(readReviewMode(''), 'shared');
  assert.equal(readReviewMode(42), 'shared');
});

test('partitionByReviewMode: splits skills by review_mode, defaulting to shared', () => {
  const skills = [
    { name: 'critical-issues-only', content: '---\nname: a\nreview_mode: shared\n---\n' },
    { name: 'brand-voice-review',    content: '---\nname: b\nreview_mode: dedicated\n---\n' },
    { name: 'no-mode',               content: '---\nname: c\n---\n' },
    { name: 'pii-and-compliance',    content: '---\nname: d\nreview_mode: dedicated\n---\n' },
  ];
  const { shared, dedicated } = partitionByReviewMode(skills);
  assert.deepEqual(shared.map((s) => s.name), ['critical-issues-only', 'no-mode']);
  assert.deepEqual(dedicated.map((s) => s.name), ['brand-voice-review', 'pii-and-compliance']);
});

test('partitionByReviewMode: handles skills with no content (defaults to shared)', () => {
  const skills = [
    { name: 'a' },                      // no content
    { name: 'b', content: undefined },  // explicit undefined
    { name: 'c', content: '---\nname: c\nreview_mode: dedicated\n---\n' },
  ];
  const { shared, dedicated } = partitionByReviewMode(skills);
  assert.deepEqual(shared.map((s) => s.name), ['a', 'b']);
  assert.deepEqual(dedicated.map((s) => s.name), ['c']);
});

// --- BB.3: per-skill check-run classifier (v0.5.10) ---
// classifyPerSkillOutcome + extractPerSkillLine are the source of truth that
// the composite strict-mode-gate action calls into via `node -e ...` for
// every entry in .clud-bug.json's strictSkills array. Bash regex shipped in
// PR #57's first revision had a "0 findings" substring match that silently
// passed "10 findings" / "100 findings" as success — caught by both bots,
// fixed here, pinned by these tests.

const SAMPLE_COMMENT = [
  '## 🐛 Clud Bug review',
  '',
  '**This round:** 0 critical · 0 minor · 0 resolved from prior · 0 still open',
  '',
  '### Per-skill scan',
  '- [critical-issues-only]: scanned all paths. 0 findings.',
  '- [evidence-based-review]: applied to all findings. ✓ all anchored.',
  '- [brand-voice-review]: scanned 3 microcopy changes. 1 finding (below).',
  '- [pii-and-compliance]: scanned analytics + logging. 10 findings (below).',
  '- [api-contract-enforcement]: n/a — no public API surface in this diff.',
  '',
].join('\n');

test('extractPerSkillLine: returns the outcome portion stripped of the prefix', () => {
  assert.equal(
    extractPerSkillLine(SAMPLE_COMMENT, 'critical-issues-only'),
    'scanned all paths. 0 findings.',
  );
  assert.equal(
    extractPerSkillLine(SAMPLE_COMMENT, 'brand-voice-review'),
    'scanned 3 microcopy changes. 1 finding (below).',
  );
});

test('extractPerSkillLine: returns null when the skill is absent', () => {
  assert.equal(extractPerSkillLine(SAMPLE_COMMENT, 'no-such-skill'), null);
});

test('extractPerSkillLine: bracket prefix prevents partial-name collisions', () => {
  // "brand-voice" must NOT match a line for "brand-voice-review".
  assert.equal(extractPerSkillLine(SAMPLE_COMMENT, 'brand-voice'), null);
});

test('extractPerSkillLine: handles missing/empty inputs without throwing', () => {
  assert.equal(extractPerSkillLine(null, 'x'), null);
  assert.equal(extractPerSkillLine('', 'x'), null);
  assert.equal(extractPerSkillLine(SAMPLE_COMMENT, ''), null);
  assert.equal(extractPerSkillLine(SAMPLE_COMMENT, null), null);
});

test('classifyPerSkillOutcome: "0 findings" → success', () => {
  assert.equal(classifyPerSkillOutcome('scanned all paths. 0 findings.'), 'success');
});

test('classifyPerSkillOutcome: "0 finding" (singular) → success', () => {
  // Singular is theoretically nonsensical ("0 finding" not "0 findings") but
  // a lazy bot rendering of `${n} finding${plural}` could emit it.
  assert.equal(classifyPerSkillOutcome('scanned. 0 finding.'), 'success');
});

test('classifyPerSkillOutcome: REGRESSION — "10 findings" does NOT match 0 substring (failure)', () => {
  // The exact bug both bots caught on PR #57. "10 findings" contains the
  // literal substring "0 findings"; an unanchored match would classify this
  // as success. The leading-non-digit anchor (`(^|[^0-9])`) prevents it.
  assert.equal(classifyPerSkillOutcome('scanned. 10 findings (below).'), 'failure');
  assert.equal(classifyPerSkillOutcome('scanned. 100 findings.'), 'failure');
  assert.equal(classifyPerSkillOutcome('scanned. 20 findings.'), 'failure');
});

test('classifyPerSkillOutcome: any other finding count → failure', () => {
  assert.equal(classifyPerSkillOutcome('1 finding (below).'), 'failure');
  assert.equal(classifyPerSkillOutcome('2 critical findings below.'), 'failure');
  assert.equal(classifyPerSkillOutcome('scanned 3 microcopy changes. 1 finding (below).'), 'failure');
});

test('classifyPerSkillOutcome: "n/a" → success', () => {
  assert.equal(classifyPerSkillOutcome('n/a — no API surface in this diff.'), 'success');
  // Trailing punctuation handled.
  assert.equal(classifyPerSkillOutcome('n/a.'), 'success');
  // Bare n/a at end-of-line.
  assert.equal(classifyPerSkillOutcome('skipped, n/a'), 'success');
});

test('classifyPerSkillOutcome: null/missing line → failure (skill not in review)', () => {
  // GitHub branch protection treats `conclusion: neutral` as PASSING for
  // required checks (only failure / cancelled / timed_out / action_required
  // block merge). So a strictSkills entry that doesn't appear in the bot's
  // per-skill scan block (typo, prompt regression, race) MUST classify as
  // `failure` — otherwise the gate the user opted into is silently green.
  // claude-review caught this on PR #57's first revision.
  assert.equal(classifyPerSkillOutcome(null), 'failure');
  assert.equal(classifyPerSkillOutcome(undefined), 'failure');
});

test('classifyPerSkillOutcome: missing skill in review block → failure (named)', () => {
  // Named version of the assertion above, walking through
  // extractPerSkillLine to exercise the full "strictSkill typo" /
  // "skill dropped from review output" scenario as a single integrated test.
  const commentWithoutBrandSkill = [
    '## 🐛 Clud Bug review',
    '',
    '### Per-skill scan',
    '- [critical-issues-only]: scanned all paths. 0 findings.',
    '- [evidence-based-review]: applied. ✓ all anchored.',
  ].join('\n');
  // User configured strictSkills: ["brand-voice-review"] but the bot's
  // review block doesn't mention it.
  const line = extractPerSkillLine(commentWithoutBrandSkill, 'brand-voice-review');
  assert.equal(line, null, 'extractPerSkillLine returns null for absent skill');
  assert.equal(classifyPerSkillOutcome(line), 'failure', 'absent skill must fail the gate, not neutral-pass it');
});

test('classifyPerSkillOutcome: empty string → failure (line present but unparseable)', () => {
  // Empty outcome line means the bot emitted "- [name]: " with no text —
  // that's broken output, not "no findings." Conservative classification:
  // failure surfaces the issue rather than greenlighting a malformed review.
  assert.equal(classifyPerSkillOutcome(''), 'failure');
});

test('classifyPerSkillOutcome: SAMPLE_COMMENT end-to-end matches expected classifications', () => {
  const cases = [
    ['critical-issues-only', 'success'],   // 0 findings
    ['brand-voice-review',   'failure'],   // 1 finding
    ['pii-and-compliance',   'failure'],   // 10 findings (regression check)
    ['api-contract-enforcement', 'success'], // n/a
    ['nonexistent-skill',   'failure'],    // not in review → fail loud (not neutral, which BP would pass)
  ];
  for (const [name, expected] of cases) {
    const line = extractPerSkillLine(SAMPLE_COMMENT, name);
    assert.equal(classifyPerSkillOutcome(line), expected, `${name} should be ${expected}`);
  }
});

test('readReviewMode: all 4 bundled baseline skills declare shared mode', async () => {
  // Pins the contract that v0.5.9 added: baselines are bug-finding /
  // convention / evidence skills; bundling them in one Claude call preserves
  // cross-correlation. If a future baseline drifts to dedicated, this test
  // catches the regression at the right layer.
  const baselineDir = join(process.cwd(), 'templates', 'skills', 'baseline');
  const { readdir, readFile } = await import('node:fs/promises');
  const names = (await readdir(baselineDir)).filter((n) => n.endsWith('.md'));
  assert.ok(names.length >= 4, `expected ≥4 bundled baselines, found ${names.length}`);
  for (const name of names) {
    const content = await readFile(join(baselineDir, name), 'utf8');
    assert.equal(readReviewMode(content), 'shared', `baseline ${name} should be shared-mode`);
  }
});

// --- v0.5.12: strict-mode-gate header selection (preamble bug fix) ---
// Pre-v0.5.12, the composite filter used `.body | startswith("## 🐛 Clud Bug review")`
// in jq. claude-code-action prepends `**Claude finished @user's task in Nm Ns**`
// to every bot comment, so the H2 header never sat at body position 0 — the
// filter matched zero comments and strict mode was silently disabled on every
// install with strictMode: true. PR #60 dogfooded BB.3 and caught it; v0.5.12
// extracts the H2 line by multi-line regex anchor instead.

// The exact body shape claude-code-action posts in production: a "Claude
// finished" preamble + a horizontal rule + the real review body.
const BOT_PREAMBLE_COMMENT = [
  "**Claude finished @thrillmot's task in 3m 23s** —— [View job](https://example.com)",
  '',
  '---',
  '## 🐛 Clud Bug review — critical findings',
  '',
  '**This round:** 1 critical · 0 minor · 0 resolved from prior · 0 still open',
  '',
  '### Critical findings',
  '...',
].join('\n');

const BOT_CLEAN_COMMENT = [
  "**Claude finished @thrillmot's task in 1m 47s** —— [View job](https://example.com)",
  '',
  '---',
  '## 🐛 Clud Bug review — clean',
  '',
  '**This round:** 0 critical · 0 minor · 0 resolved from prior · 0 still open',
].join('\n');

test('extractFirstReviewHeaderLine: extracts the H2 header line past claude-code-action preamble', () => {
  // REGRESSION GUARD: pre-v0.5.12 startswith() returned null/empty here.
  assert.equal(
    extractFirstReviewHeaderLine(BOT_PREAMBLE_COMMENT),
    '## 🐛 Clud Bug review — critical findings',
  );
  assert.equal(
    extractFirstReviewHeaderLine(BOT_CLEAN_COMMENT),
    '## 🐛 Clud Bug review — clean',
  );
});

test('extractFirstReviewHeaderLine: returns null when no H2 sentinel present', () => {
  assert.equal(extractFirstReviewHeaderLine('just some comment text'), null);
  assert.equal(extractFirstReviewHeaderLine(''), null);
  assert.equal(extractFirstReviewHeaderLine(null), null);
  assert.equal(extractFirstReviewHeaderLine(42), null);
});

test('extractFirstReviewHeaderLine: does NOT match the sentinel quoted in prose (start-of-line anchored)', () => {
  // The "don't trip on quoted sentinels" safety property the pre-v0.5.12
  // gate had via startswith — preserved here via the (?m)^ anchor.
  const quotedInProse = [
    'Some bot mentioning the strict-mode header `## 🐛 Clud Bug review — critical findings`',
    'in inline-code, not as a real header.',
  ].join('\n');
  assert.equal(extractFirstReviewHeaderLine(quotedInProse), null);
});

test('extractFirstReviewHeaderLine: picks the FIRST H2 sentinel when multiple appear', () => {
  // Bot's prompt body sometimes documents the strict-mode header variants
  // in its own output. The FIRST line-anchored match is the real header.
  const multiSentinel = [
    'preamble',
    '## 🐛 Clud Bug review — clean',
    '',
    'In strict mode the header is either:',
    '## 🐛 Clud Bug review — clean',
    '## 🐛 Clud Bug review — critical findings',
  ].join('\n');
  assert.equal(extractFirstReviewHeaderLine(multiSentinel), '## 🐛 Clud Bug review — clean');
});

test('selectReviewHeader: returns the H2 header from the latest claude[bot] comment past the preamble', () => {
  // Comments arrive newest-first from `gh api ...?sort=created&direction=desc`.
  const comments = [
    { user: { login: 'claude[bot]' }, body: BOT_PREAMBLE_COMMENT },
    { user: { login: 'claude[bot]' }, body: 'older bot comment without the H2 sentinel' },
  ];
  assert.equal(
    selectReviewHeader(comments, 'claude[bot]'),
    '## 🐛 Clud Bug review — critical findings',
  );
});

test('selectReviewHeader: skips non-bot comments even when they contain the sentinel', () => {
  // A user comment that quotes the sentinel must not satisfy the gate.
  const comments = [
    { user: { login: 'someuser' }, body: '## 🐛 Clud Bug review — critical findings (quoting the bot)' },
    { user: { login: 'claude[bot]' }, body: BOT_CLEAN_COMMENT },
  ];
  assert.equal(
    selectReviewHeader(comments, 'claude[bot]'),
    '## 🐛 Clud Bug review — clean',
  );
});

test('selectReviewHeader: returns null when no bot comment has the sentinel', () => {
  const comments = [
    { user: { login: 'claude[bot]' }, body: 'preamble only, no review header' },
    { user: { login: 'claude[bot]' }, body: '**Claude finished**\n\nWorking...' },
  ];
  assert.equal(selectReviewHeader(comments, 'claude[bot]'), null);
});

test('selectReviewHeader: handles missing/malformed inputs safely', () => {
  assert.equal(selectReviewHeader(null, 'claude[bot]'), null);
  assert.equal(selectReviewHeader([], 'claude[bot]'), null);
  assert.equal(selectReviewHeader([{ user: { login: 'claude[bot]' }, body: BOT_CLEAN_COMMENT }], ''), null);
  assert.equal(selectReviewHeader([{ user: null, body: BOT_CLEAN_COMMENT }], 'claude[bot]'), null);
  assert.equal(selectReviewHeader([null, undefined, 'not-an-object'], 'claude[bot]'), null);
});

test('selectReviewHeader: configurable bot-login works for the v0.6 App identity (clud-bug[bot])', () => {
  // The composite action exposes `bot-login` as an input (defaults to claude[bot]).
  // v0.6 will post as clud-bug[bot]; the same logic must drive that gate.
  const comments = [
    { user: { login: 'clud-bug[bot]' }, body: BOT_PREAMBLE_COMMENT },
  ];
  assert.equal(
    selectReviewHeader(comments, 'clud-bug[bot]'),
    '## 🐛 Clud Bug review — critical findings',
  );
  // Wrong bot-login finds nothing.
  assert.equal(selectReviewHeader(comments, 'claude[bot]'), null);
});

test('isCriticalReviewHeader: only matches the "— critical findings" variant', () => {
  assert.equal(isCriticalReviewHeader('## 🐛 Clud Bug review — critical findings'), true);
  assert.equal(isCriticalReviewHeader('## 🐛 Clud Bug review — clean'), false);
  // The non-strict-mode bare header should also not fire the gate.
  assert.equal(isCriticalReviewHeader('## 🐛 Clud Bug review'), false);
  assert.equal(isCriticalReviewHeader(null), false);
  assert.equal(isCriticalReviewHeader(''), false);
});

test('selectReviewBody: returns FULL body of the latest bot review past the preamble (BB.3 fix)', () => {
  // REGRESSION GUARD: pre-v0.5.12 BB.3 step 2 used the same broken
  // .body | startswith() jq filter as the gate step. Per-skill check-runs
  // were silently disabled on every install with strictSkills since v0.5.10.
  // Caught by both bots on PR #61.
  const comments = [
    { user: { login: 'claude[bot]' }, body: BOT_PREAMBLE_COMMENT },
    { user: { login: 'claude[bot]' }, body: 'older bot comment without the H2 sentinel' },
  ];
  // Must return the FULL body (not just the header line) — BB.3 needs the
  // body to grep the "### Per-skill scan" block for per-skill outcomes.
  assert.equal(selectReviewBody(comments, 'claude[bot]'), BOT_PREAMBLE_COMMENT);
});

test('selectReviewBody: filters out user-authored comments even when they contain the sentinel', () => {
  const comments = [
    { user: { login: 'someuser' }, body: BOT_CLEAN_COMMENT }, // user quoting the bot
    { user: { login: 'claude[bot]' }, body: BOT_PREAMBLE_COMMENT },
  ];
  assert.equal(selectReviewBody(comments, 'claude[bot]'), BOT_PREAMBLE_COMMENT);
});

test('selectReviewBody: returns null when no bot comment has the sentinel', () => {
  const comments = [
    { user: { login: 'claude[bot]' }, body: 'preamble only, no review header' },
    { user: { login: 'claude[bot]' }, body: '**Claude finished**\n\nWorking...' },
  ];
  assert.equal(selectReviewBody(comments, 'claude[bot]'), null);
});

test('selectReviewBody: handles missing/malformed inputs safely', () => {
  assert.equal(selectReviewBody(null, 'claude[bot]'), null);
  assert.equal(selectReviewBody([], 'claude[bot]'), null);
  assert.equal(selectReviewBody([{ user: { login: 'claude[bot]' }, body: BOT_CLEAN_COMMENT }], ''), null);
  assert.equal(selectReviewBody([{ user: null, body: BOT_CLEAN_COMMENT }], 'claude[bot]'), null);
  assert.equal(selectReviewBody([null, undefined, 'not-an-object'], 'claude[bot]'), null);
});

test('selectReviewBody: configurable bot-login works for v0.6 App identity', () => {
  // Symmetric with selectReviewHeader — both helpers must accept the
  // App's clud-bug[bot] identity when v0.6 ships.
  const comments = [{ user: { login: 'clud-bug[bot]' }, body: BOT_CLEAN_COMMENT }];
  assert.equal(selectReviewBody(comments, 'clud-bug[bot]'), BOT_CLEAN_COMMENT);
  assert.equal(selectReviewBody(comments, 'claude[bot]'), null);
});

test('selectReviewBody + extractPerSkillLine: end-to-end BB.3 path works through the preamble', () => {
  // The full BB.3 step 2 flow:
  //   1. gh api → comments list with preamble-prefixed bot comments
  //   2. selectReviewBody → real review body
  //   3. extractPerSkillLine → per-skill outcome line
  //   4. classifyPerSkillOutcome → check-run conclusion
  // Pre-v0.5.12 step 2 silently returned empty body for every install.
  const reviewWithSkills = [
    "**Claude finished @user's task in 2m 47s** —— [View job](https://example.com)",
    '',
    '---',
    '## 🐛 Clud Bug review — clean',
    '',
    '**This round:** 0 critical · 0 minor · 0 resolved from prior · 0 still open',
    '',
    '### Per-skill scan',
    '- [critical-issues-only]: scanned all paths. 0 findings.',
    '- [evidence-based-review]: applied to all findings. ✓ all anchored.',
    '- [brand-voice-review]: scanned 2 microcopy changes. 1 finding (below).',
  ].join('\n');
  const comments = [{ user: { login: 'claude[bot]' }, body: reviewWithSkills }];
  const body = selectReviewBody(comments, 'claude[bot]');
  assert.ok(body, 'selectReviewBody must return the body past the preamble');
  // Now the BB.3 step can extract per-skill outcomes from it.
  assert.equal(extractPerSkillLine(body, 'critical-issues-only'), 'scanned all paths. 0 findings.');
  assert.equal(extractPerSkillLine(body, 'brand-voice-review'), 'scanned 2 microcopy changes. 1 finding (below).');
});

// --- v0.5.13: API ordering regression ---
// gh api .../issues/X/comments?sort=created&direction=desc IGNORES direction
// and returns ascending (oldest first). Pre-v0.5.13 selectReviewHeader walked
// the array in API order, picking the OLDEST matching comment. PR #64 caught
// it: round 1 critical-findings comment shadowed round 2's clean comment,
// so fix-push reviews stayed gated. v0.5.13 sorts newest-first explicitly.

test('selectReviewHeader: REGRESSION — picks NEWEST comment even when input is oldest-first (gh api ordering quirk)', () => {
  // Simulate gh api's actual return order: oldest comment first.
  const apiOrder = [
    {
      user: { login: 'claude[bot]' },
      created_at: '2026-05-26T17:11:30Z',
      body: '**Claude finished**\n\n---\n## 🐛 Clud Bug review — critical findings\n\nRound 1 verdict.',
    },
    {
      user: { login: 'claude[bot]' },
      created_at: '2026-05-26T17:19:10Z',
      body: '**Claude finished**\n\n---\n## 🐛 Clud Bug review — clean\n\nRound 2 verdict after fix-push.',
    },
  ];
  // Must return the NEWER clean header, not the older critical-findings one.
  assert.equal(
    selectReviewHeader(apiOrder, 'claude[bot]'),
    '## 🐛 Clud Bug review — clean',
    'selectReviewHeader must sort by created_at desc internally — relying on gh api direction=desc fails',
  );
});

test('selectReviewBody: REGRESSION — picks NEWEST comment even when input is oldest-first', () => {
  const apiOrder = [
    {
      user: { login: 'claude[bot]' },
      created_at: '2026-05-26T17:11:30Z',
      body: '## 🐛 Clud Bug review — critical findings\n\nOLD body.',
    },
    {
      user: { login: 'claude[bot]' },
      created_at: '2026-05-26T17:19:10Z',
      body: '## 🐛 Clud Bug review — clean\n\nNEW body after fix-push.',
    },
  ];
  const body = selectReviewBody(apiOrder, 'claude[bot]');
  assert.match(body, /NEW body after fix-push/, 'selectReviewBody must pick the newest matching comment');
  assert.doesNotMatch(body, /OLD body/);
});

test('selectReviewHeader: handles missing created_at gracefully (treats as oldest)', () => {
  // Defensive: if a caller passes comments without created_at, the sort
  // should not crash. Missing timestamp = treat as oldest (gets sorted
  // to the end, walked last). A single matching comment with no timestamp
  // still returns its header.
  const comments = [
    { user: { login: 'claude[bot]' }, body: '## 🐛 Clud Bug review — clean' },
  ];
  assert.equal(selectReviewHeader(comments, 'claude[bot]'), '## 🐛 Clud Bug review — clean');
});

test('isCriticalReviewHeader: end-to-end with selectReviewHeader matches the v0.5.x gate contract', () => {
  // Synthesize the exact data flow the composite action sees: a list of
  // comments from gh api, filter via selectReviewHeader, then ask whether
  // the result is the critical variant.
  const failingComments = [{ user: { login: 'claude[bot]' }, body: BOT_PREAMBLE_COMMENT }];
  const passingComments = [{ user: { login: 'claude[bot]' }, body: BOT_CLEAN_COMMENT }];
  const noReviewYet = [];

  assert.equal(isCriticalReviewHeader(selectReviewHeader(failingComments, 'claude[bot]')), true);
  assert.equal(isCriticalReviewHeader(selectReviewHeader(passingComments, 'claude[bot]')), false);
  assert.equal(isCriticalReviewHeader(selectReviewHeader(noReviewYet, 'claude[bot]')), false);
});
