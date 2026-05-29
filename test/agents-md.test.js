import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { applyToRepo, hasAgentsMdImport, removeBlock, renderBlock, upsertBlock } from '../lib/agents-md.js';

async function makeRepo(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-agents-md-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

async function exists(p) { try { await stat(p); return true; } catch { return false; } }

test('renderBlock: includes start/end markers and strict-mode line', () => {
  const block = renderBlock({ version: '0.5.1', strictMode: true });
  assert.match(block, /<!-- clud-bug-start -->/);
  assert.match(block, /<!-- clud-bug-end -->/);
  assert.match(block, /Strict mode is \*\*on\*\*/);
  assert.match(block, /clud-bug v0\.5\.1/);
});

test('renderBlock: strictMode false renders advisory text', () => {
  const block = renderBlock({ version: '0.5.1', strictMode: false });
  assert.match(block, /Strict mode is \*\*off\*\*/);
});

// --- 0.A.5 (v0.6.6): block trim — full rules move to clud-bug-collaboration skill ---

test('renderBlock v2: trimmed to a pointer + strict-mode toggle (≤600 chars)', () => {
  // The full collaboration rules (fix-push, comment format, workflow-edit
  // constraint, skill structure) moved to the bundled clud-bug-collaboration
  // skill in agent-skills. AGENTS.md becomes a minimal pointer so every
  // agent session in every consuming repo reads fewer bytes at session boot.
  const block = renderBlock({ version: '0.6.6', strictMode: true });
  // 1000 char cap — generous ceiling vs the v1 ~2100-char block. v0.6.7's
  // block adds a CLUD_BUG_QUIET hint that brings it to ~900 chars; the
  // ceiling absorbs future small additions without ratcheting back up
  // toward v1's verbosity. Still a ~55%+ reduction from v1.
  assert.ok(block.length <= 1000, `block too long: ${block.length} chars`);
  // Must point at the bundled skill explicitly so agents know where the
  // detail moved.
  assert.match(block, /clud-bug-collaboration/);
  assert.match(block, /\.claude\/skills\/clud-bug-collaboration\/SKILL\.md/);
  // Block-version annotation MUST advance with content trim so consumers
  // can detect the schema change in their checked-in AGENTS.md.
  assert.match(block, /clud-bug-block-version: v2/);
  // Strict-mode toggle stays in the block (it's repo-specific and varies
  // per consumer — can't move it to a canonical skill).
  assert.match(block, /Strict mode is \*\*on\*\*/);
});

test('renderBlock v2: dropped sections do NOT appear anywhere in the block', () => {
  const block = renderBlock({ version: '0.6.6', strictMode: true });
  // These sections moved to the skill — should be GONE from AGENTS.md block.
  assert.doesNotMatch(block, /When you push fixes addressing prior/);
  assert.doesNotMatch(block, /Editing the workflow/);
  assert.doesNotMatch(block, /Where the skills live/);
});

test('upsertBlock: appends when no prior block', () => {
  const before = '# AGENTS.md\n\nSome content.\n';
  const block = renderBlock({ strictMode: true });
  const after = upsertBlock(before, block);
  assert.match(after, /Some content\./);
  assert.match(after, /<!-- clud-bug-start -->/);
  // Single occurrence.
  assert.equal(after.match(/<!-- clud-bug-start -->/g).length, 1);
});

test('upsertBlock: replaces existing block in place (idempotent)', () => {
  const before = '# AGENTS.md\n\nIntro.\n\n<!-- clud-bug-start -->\nold body\n<!-- clud-bug-end -->\n\nFooter.\n';
  const block = renderBlock({ version: '0.5.1', strictMode: true });
  const after = upsertBlock(before, block);
  assert.doesNotMatch(after, /old body/);
  assert.match(after, /clud-bug v0\.5\.1/);
  assert.match(after, /Intro\./);
  assert.match(after, /Footer\./);
  // Still single occurrence.
  assert.equal(after.match(/<!-- clud-bug-start -->/g).length, 1);
});

test('upsertBlock: running twice in a row produces identical output', () => {
  const block = renderBlock({ version: '0.5.1', strictMode: true });
  const once = upsertBlock('# AGENTS.md\n', block);
  const twice = upsertBlock(once, block);
  assert.equal(once, twice);
});

test('applyToRepo: creates AGENTS.md when missing, no other files', async () => {
  const dir = await makeRepo({});
  try {
    const r = await applyToRepo(dir, { version: '0.5.1', strictMode: true });
    assert.deepEqual(r.created, ['AGENTS.md']);
    assert.deepEqual(r.touched, []);
    const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8');
    assert.match(agents, /<!-- clud-bug-start -->/);
    assert.match(agents, /clud-bug v0\.5\.1/);
    // Did not create CLAUDE.md or anything else.
    assert.equal(await exists(join(dir, 'CLAUDE.md')), false);
    assert.equal(await exists(join(dir, '.cursorrules')), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('applyToRepo: appends to existing AGENTS.md without touching prior content', async () => {
  const dir = await makeRepo({
    'AGENTS.md': '# AGENTS.md\n\nLogmind block here.\n\n<!-- logmind-start -->\nlogmind stuff\n<!-- logmind-end -->\n',
  });
  try {
    const r = await applyToRepo(dir, { version: '0.5.1', strictMode: true });
    assert.deepEqual(r.created, []);
    assert.deepEqual(r.touched, ['AGENTS.md']);
    const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8');
    // Logmind block preserved.
    assert.match(agents, /<!-- logmind-start -->/);
    assert.match(agents, /logmind stuff/);
    // Clud-bug block added.
    assert.match(agents, /<!-- clud-bug-start -->/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('applyToRepo: updates existing CLAUDE.md, .cursorrules, copilot-instructions.md', async () => {
  const dir = await makeRepo({
    'AGENTS.md': '# AGENTS.md\n',
    'CLAUDE.md': '# CLAUDE\n\nstuff\n',
    '.cursorrules': 'cursor rules\n',
    '.github/copilot-instructions.md': '# Copilot\n',
  });
  try {
    const r = await applyToRepo(dir, { version: '0.5.1', strictMode: false });
    assert.deepEqual(r.created.sort(), []);
    assert.deepEqual(
      r.touched.sort(),
      ['.cursorrules', '.github/copilot-instructions.md', 'AGENTS.md', 'CLAUDE.md'],
    );
    const claude = await readFile(join(dir, 'CLAUDE.md'), 'utf8');
    assert.match(claude, /<!-- clud-bug-start -->/);
    assert.match(claude, /Strict mode is \*\*off\*\*/);
    assert.match(claude, /^# CLAUDE/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('applyToRepo: idempotent — second run is a no-op', async () => {
  const dir = await makeRepo({
    'CLAUDE.md': '# CLAUDE\n',
  });
  try {
    await applyToRepo(dir, { version: '0.5.1', strictMode: true });
    const after1 = await readFile(join(dir, 'CLAUDE.md'), 'utf8');
    const r2 = await applyToRepo(dir, { version: '0.5.1', strictMode: true });
    const after2 = await readFile(join(dir, 'CLAUDE.md'), 'utf8');
    assert.equal(after1, after2, 'second run should produce identical content');
    assert.deepEqual(r2.created, []);
    // The second run still reports CLAUDE.md and AGENTS.md as touched targets,
    // but content is unchanged on disk — what matters here is byte-equality.
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('applyToRepo: re-running with new version replaces the prior block', async () => {
  const dir = await makeRepo({});
  try {
    await applyToRepo(dir, { version: '0.5.0', strictMode: true });
    await applyToRepo(dir, { version: '0.5.1', strictMode: true });
    const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8');
    assert.equal(agents.match(/<!-- clud-bug-start -->/g).length, 1, 'one block, not two');
    assert.match(agents, /clud-bug v0\.5\.1/);
    assert.doesNotMatch(agents, /clud-bug v0\.5\.0/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('applyToRepo: walks .cursor/rules/*.md', async () => {
  const dir = await makeRepo({
    '.cursor/rules/general.md': '# general\n',
    '.cursor/rules/typescript.md': '# ts\n',
    '.cursor/rules/skip.txt': 'not markdown',
  });
  try {
    const r = await applyToRepo(dir, { strictMode: true });
    assert.ok(r.touched.includes('.cursor/rules/general.md'));
    assert.ok(r.touched.includes('.cursor/rules/typescript.md'));
    assert.ok(!r.touched.some((p) => p.endsWith('skip.txt')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('renderBlock: strictMode undefined renders advisory (matches workflow gate predicate)', () => {
  // The workflow at templates/workflow*.yml.tmpl reads `JSON.parse(s).strictMode === true`.
  // Anything other than explicit `true` (undefined, null, false) is advisory.
  // The block must report the same.
  const block = renderBlock({ version: '0.5.1' });   // strictMode left undefined
  assert.match(block, /Strict mode is \*\*off\*\*/);
  assert.doesNotMatch(block, /Strict mode is \*\*on\*\*/);
});

test('renderBlock: strictMode null renders advisory', () => {
  const block = renderBlock({ version: '0.5.1', strictMode: null });
  assert.match(block, /Strict mode is \*\*off\*\*/);
});

test('regression: v0.3-shaped manifest (lastUpdate set, strictMode undefined) renders "off"', async () => {
  // This pins the v0.3 advisory upgrade path. bin/clud-bug.js#runInit
  // deliberately keeps strictMode undefined when lastUpdate already exists
  // (test/cli.test.js: "existing v0.3 advisory install ... is NOT auto-flipped").
  // The brief must match the actual gate state, not the v0.4 default.
  const dir = await makeRepo({});
  try {
    // Simulate what bin/clud-bug.js passes for a v0.3 manifest: strictMode === true is false.
    await applyToRepo(dir, { version: '0.5.1', strictMode: false /* === (undefined === true) */ });
    const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8');
    assert.match(agents, /Strict mode is \*\*off\*\*/);
    assert.doesNotMatch(agents, /Strict mode is \*\*on\*\*/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('applyToRepo: does not create CLAUDE.md or other tool files when absent', async () => {
  const dir = await makeRepo({});
  try {
    await applyToRepo(dir, { strictMode: true });
    assert.equal(await exists(join(dir, 'AGENTS.md')), true, 'AGENTS.md is the canonical home — created');
    assert.equal(await exists(join(dir, 'CLAUDE.md')), false);
    assert.equal(await exists(join(dir, 'GEMINI.md')), false);
    assert.equal(await exists(join(dir, '.cursorrules')), false);
    assert.equal(await exists(join(dir, '.windsurfrules')), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// --- 0.0.I.1 (v0.6.X): @AGENTS.md import detection + block-skip ---

test('hasAgentsMdImport: matches `@AGENTS.md` at start of line', () => {
  assert.equal(hasAgentsMdImport('@AGENTS.md\n\n# rest\n'), true);
  assert.equal(hasAgentsMdImport('# heading\n\n@AGENTS.md\n\nfooter\n'), true);
  // Trailing whitespace tolerated (some editors trim, some don't).
  assert.equal(hasAgentsMdImport('@AGENTS.md   \n'), true);
});

test('hasAgentsMdImport: does NOT match prose mentions or partial matches', () => {
  // Prose mention — has surrounding text on the same line.
  assert.equal(hasAgentsMdImport('See @AGENTS.md for rules\n'), false);
  // Wrong file name.
  assert.equal(hasAgentsMdImport('@CLAUDE.md\n'), false);
  // Empty / non-string inputs.
  assert.equal(hasAgentsMdImport(''), false);
  assert.equal(hasAgentsMdImport(null), false);
  assert.equal(hasAgentsMdImport(undefined), false);
});

test('removeBlock: strips the block AND a preceding blank line', () => {
  const before = '# CLAUDE.md\n\nSee AGENTS.md.\n\n<!-- clud-bug-start -->\nbody\n<!-- clud-bug-end -->\n';
  const after = removeBlock(before);
  assert.doesNotMatch(after, /clud-bug-start/);
  assert.doesNotMatch(after, /clud-bug-end/);
  // Preserves the surrounding content.
  assert.match(after, /# CLAUDE\.md/);
  assert.match(after, /See AGENTS\.md\./);
  // Does NOT leave a double-blank-line dent where the block used to be.
  assert.doesNotMatch(after, /\n\n\n/);
});

test('removeBlock: idempotent — running twice produces the same result', () => {
  const before = '@AGENTS.md\n\n# stuff\n\n<!-- clud-bug-start -->\nx\n<!-- clud-bug-end -->\n';
  const once = removeBlock(before);
  const twice = removeBlock(once);
  assert.equal(once, twice);
  // No block present → unchanged.
  assert.doesNotMatch(once, /clud-bug-/);
});

test('removeBlock: no-op when no block is present', () => {
  const before = '@AGENTS.md\n\n# clean\n';
  assert.equal(removeBlock(before), before);
});

test('applyToRepo: SKIPS clud-bug block in CLAUDE.md when @AGENTS.md import is present', async () => {
  // The 0.0.I.1 contract: if CLAUDE.md already imports AGENTS.md, the
  // AGENTS.md block is the canonical source — don't duplicate into CLAUDE.md.
  const dir = await makeRepo({
    'AGENTS.md': '# AGENTS.md\n',
    'CLAUDE.md': '@AGENTS.md\n\n# CLAUDE.md stub\n',
  });
  try {
    const r = await applyToRepo(dir, { version: '0.6.18', strictMode: true });
    // AGENTS.md still gets the block — it's the source of truth.
    const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8');
    assert.match(agents, /<!-- clud-bug-start -->/);
    // CLAUDE.md does NOT get a block.
    const claude = await readFile(join(dir, 'CLAUDE.md'), 'utf8');
    assert.doesNotMatch(claude, /<!-- clud-bug-start -->/);
    // CLAUDE.md prior content preserved.
    assert.match(claude, /@AGENTS\.md/);
    assert.match(claude, /# CLAUDE\.md stub/);
    // Touched array does NOT mention CLAUDE.md (no write happened).
    assert.equal(r.touched.includes('CLAUDE.md'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('applyToRepo: REMOVES stale clud-bug block from CLAUDE.md when @AGENTS.md import is present', async () => {
  // Migration path: an older clud-bug version installed the block into
  // CLAUDE.md. The user has since added @AGENTS.md at the top. Now the
  // block is duplicated content. clud-bug init/update should clean it up.
  const dir = await makeRepo({
    'AGENTS.md': '# AGENTS.md\n',
    'CLAUDE.md': '@AGENTS.md\n\n# stub\n\n<!-- clud-bug-start -->\nOLD STALE BLOCK\n<!-- clud-bug-end -->\n',
  });
  try {
    const r = await applyToRepo(dir, { version: '0.6.18', strictMode: true });
    const claude = await readFile(join(dir, 'CLAUDE.md'), 'utf8');
    assert.doesNotMatch(claude, /<!-- clud-bug-start -->/);
    assert.doesNotMatch(claude, /OLD STALE BLOCK/);
    assert.match(claude, /@AGENTS\.md/);
    assert.match(claude, /# stub/);
    // Touched because we modified the file (block removed).
    assert.ok(r.touched.includes('CLAUDE.md'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('applyToRepo: STILL installs block into CLAUDE.md when @AGENTS.md import is absent', async () => {
  // Back-compat: repos that don't use Claude Code's @-import still get the
  // block in their tool stub files. The skip behavior is opt-in via import.
  const dir = await makeRepo({
    'AGENTS.md': '# AGENTS.md\n',
    'CLAUDE.md': '# CLAUDE.md\n\nstuff\n',
  });
  try {
    await applyToRepo(dir, { version: '0.6.18', strictMode: true });
    const claude = await readFile(join(dir, 'CLAUDE.md'), 'utf8');
    assert.match(claude, /<!-- clud-bug-start -->/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('applyToRepo: SKIPS .cursor/rules/*.md that import @AGENTS.md', async () => {
  // Cursor rules can also use @-import. Same behaviour: skip the block
  // when the import is present.
  const dir = await makeRepo({
    'AGENTS.md': '# AGENTS.md\n',
    '.cursor/rules/general.md': '@AGENTS.md\n\n# general\n',
    '.cursor/rules/no-import.md': '# no import\n',
  });
  try {
    const r = await applyToRepo(dir, { strictMode: true });
    const general = await readFile(join(dir, '.cursor/rules/general.md'), 'utf8');
    const noImport = await readFile(join(dir, '.cursor/rules/no-import.md'), 'utf8');
    // The @AGENTS.md one gets NO block.
    assert.doesNotMatch(general, /<!-- clud-bug-start -->/);
    // The other one DOES get the block (back-compat).
    assert.match(noImport, /<!-- clud-bug-start -->/);
    // Touched array reflects only the one we wrote to.
    assert.ok(r.touched.includes('.cursor/rules/no-import.md'));
    assert.equal(r.touched.includes('.cursor/rules/general.md'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
