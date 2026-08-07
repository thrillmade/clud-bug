import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyToRepo,
  detectSkillRelPath,
  hasAgentsMdImport,
  hasAgentsMdRedirect,
  insertStub,
  removeBlock,
  renderBlock,
  renderStub,
  upsertBlock,
} from '../src/cli/agents-md.js';

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

test('applyToRepo: redirects existing CLAUDE.md, .cursorrules, copilot-instructions.md', async () => {
  // #265 / SPEC 2.0 §1.2: per-tool files get a redirect stub, NOT the block.
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
    // No block, no copied instruction body.
    assert.doesNotMatch(claude, /<!-- clud-bug-start -->/);
    assert.doesNotMatch(claude, /Strict mode is/);
    // A redirect, and the user's own content, both present.
    assert.match(claude, /<!-- clud-bug-stub:/);
    assert.match(claude, /\[AGENTS\.md\]\(AGENTS\.md\)/);
    assert.match(claude, /# CLAUDE/);
    assert.match(claude, /stuff/);
    // AGENTS.md — and only AGENTS.md — carries the block.
    const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8');
    assert.match(agents, /<!-- clud-bug-start -->/);
    assert.match(agents, /Strict mode is \*\*off\*\*/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('#265: NO per-tool file receives a copy of the block (§1.1)', async () => {
  // The violation this issue reports, pinned across the whole list. §1.1:
  // "AGENTS.md is the single source of agent instructions. A tool MUST NOT
  //  copy its content into any other file."
  const perTool = [
    'CLAUDE.md',
    'GEMINI.md',
    '.github/copilot-instructions.md',
    '.cursorrules',
    '.windsurfrules',
    '.clinerules',
    '.continuerules',
    '.cursor/rules/general.md',
  ];
  const seed = {};
  for (const p of perTool) seed[p] = `# ${p}\n\nuser content\n`;
  seed['AGENTS.md'] = '# AGENTS.md\n';
  const dir = await makeRepo(seed);
  try {
    await applyToRepo(dir, { version: '0.7.0', strictMode: true });
    // CONTROL: AGENTS.md really does get the block — so a zero below means
    // "no copy", not "the block never rendered".
    const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8');
    assert.match(agents, /<!-- clud-bug-start -->/, 'control: AGENTS.md must carry the block');
    assert.match(agents, /clud-bug-collaboration/, 'control: block body rendered');

    for (const p of perTool) {
      const c = await readFile(join(dir, p), 'utf8');
      assert.doesNotMatch(c, /<!-- clud-bug-start -->/, `${p} carries a block`);
      assert.doesNotMatch(c, /<!-- clud-bug-end -->/, `${p} carries a block`);
      // A distinctive sentence from the block body — catches a marker-less copy.
      assert.doesNotMatch(c, /Read that skill before pushing fixes/, `${p} carries block prose`);
      // …and it does carry a redirect plus the user's own bytes.
      assert.match(c, /<!-- clud-bug-stub:/, `${p} missing redirect stub`);
      assert.match(c, /user content/, `${p} lost user content`);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('#265: stub link is relative to the file\'s depth', async () => {
  const dir = await makeRepo({
    'AGENTS.md': '# AGENTS.md\n',
    'CLAUDE.md': '# c\n',
    '.github/copilot-instructions.md': '# copilot\n',
    '.cursor/rules/general.md': '# general\n',
  });
  try {
    await applyToRepo(dir, { strictMode: true });
    const root = await readFile(join(dir, 'CLAUDE.md'), 'utf8');
    const oneDeep = await readFile(join(dir, '.github/copilot-instructions.md'), 'utf8');
    const twoDeep = await readFile(join(dir, '.cursor/rules/general.md'), 'utf8');
    assert.match(root, /\]\(AGENTS\.md\)/);
    assert.match(oneDeep, /\]\(\.\.\/AGENTS\.md\)/);
    assert.match(twoDeep, /\]\(\.\.\/\.\.\/AGENTS\.md\)/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('#265: migration — a block copied by a pre-#265 clud-bug is stripped', async () => {
  // .cursorrules never qualified for the 0.0.I.1 @AGENTS.md escape hatch
  // (Cursor has no @-import), so every pre-#265 install left a copy here.
  const stale = '# my rules\n\nAlways use tabs.\n\n<!-- clud-bug-start -->\n<!-- clud-bug-block-version: v2 -->\nOLD COPIED BLOCK\n<!-- clud-bug-end -->\n';
  const dir = await makeRepo({ 'AGENTS.md': '# AGENTS.md\n', '.cursorrules': stale });
  try {
    const r = await applyToRepo(dir, { version: '0.7.0', strictMode: true });
    const cursor = await readFile(join(dir, '.cursorrules'), 'utf8');
    assert.doesNotMatch(cursor, /clud-bug-start/);
    assert.doesNotMatch(cursor, /OLD COPIED BLOCK/);
    // Hand-written content around the block survives — this is the case the
    // brief calls out: "a stub conversion must not eat it".
    assert.match(cursor, /# my rules/);
    assert.match(cursor, /Always use tabs\./);
    assert.match(cursor, /<!-- clud-bug-stub:/);
    assert.ok(r.touched.includes('.cursorrules'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('#265: an existing redirect is not duplicated (logmind stub, @-import, plain link)', async () => {
  // A per-tool file needs ONE redirect, not one per installed tool. logmind
  // owns per-tool file creation (§1.2 `agents.<name>`); if its stub is
  // already there, clud-bug adds nothing.
  const logmindStub = '<!-- logmind-stub: AI agent instructions for this project live in AGENTS.md -->\nSee [AGENTS.md](AGENTS.md) for project-specific AI agent instructions, including\nthe decision-logging requirement (logmind) and required reading.\n';
  const dir = await makeRepo({
    'AGENTS.md': '# AGENTS.md\n',
    'CLAUDE.md': `@AGENTS.md\n\n${logmindStub}`,
    '.cursorrules': logmindStub,
    '.windsurfrules': '# rules\n\nSee [AGENTS.md](AGENTS.md).\n',
  });
  try {
    const r = await applyToRepo(dir, { strictMode: true });
    for (const p of ['CLAUDE.md', '.cursorrules', '.windsurfrules']) {
      const c = await readFile(join(dir, p), 'utf8');
      assert.doesNotMatch(c, /clud-bug-stub/, `${p} got a second, redundant stub`);
      assert.equal(r.touched.includes(p), false, `${p} rewritten despite needing nothing`);
    }
    // logmind's stub is byte-identical to what it wrote.
    assert.equal(await readFile(join(dir, '.cursorrules'), 'utf8'), logmindStub);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('#265: stub goes BELOW YAML frontmatter, never above it', async () => {
  // Cursor's newer .cursor/rules/*.md format opens with frontmatter.
  // Prepending above `---` stops it being frontmatter at all.
  const dir = await makeRepo({
    'AGENTS.md': '# AGENTS.md\n',
    '.cursor/rules/general.md': '---\ndescription: general rules\nalwaysApply: true\n---\n\n# general\n',
  });
  try {
    await applyToRepo(dir, { strictMode: true });
    const c = await readFile(join(dir, '.cursor/rules/general.md'), 'utf8');
    assert.ok(c.startsWith('---\n'), 'frontmatter must still open the file');
    assert.match(c, /description: general rules/);
    assert.match(c, /alwaysApply: true/);
    // Stub sits after the closing fence, before the body.
    const fmEnd = c.indexOf('\n---', 3) + 4;
    assert.ok(c.indexOf('<!-- clud-bug-stub:') > fmEnd, 'stub must sit below frontmatter');
    assert.match(c, /# general/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('#265: never writes markdown into the JSON per-tool files (§1.2)', async () => {
  // §1.2: "Cody and Zed keep their settings in JSON that the user also owns.
  //  A tool MUST write the JSON form to those paths and MUST NOT write
  //  markdown into them, which would destroy the file."
  // clud-bug writes neither form to these paths. This pins that: the stub
  // pass must never grow to cover them by someone appending to the list.
  const cody = '{\n  "cody.chat.preInstruction": "read AGENTS.md"\n}\n';
  const zed = '{\n  "assistant": { "version": "2" }\n}\n';
  const dir = await makeRepo({
    'AGENTS.md': '# AGENTS.md\n',
    '.sourcegraph/cody.json': cody,
    '.zed/settings.json': zed,
    'CONVENTIONS.md': '# aider conventions\n',
    '.amazonq/rules.md': '# amazonq\n',
  });
  try {
    const r = await applyToRepo(dir, { version: '0.7.0', strictMode: true });
    // Byte-identical — and still parseable JSON.
    assert.equal(await readFile(join(dir, '.sourcegraph/cody.json'), 'utf8'), cody);
    assert.equal(await readFile(join(dir, '.zed/settings.json'), 'utf8'), zed);
    JSON.parse(await readFile(join(dir, '.zed/settings.json'), 'utf8'));
    assert.equal(r.touched.includes('.sourcegraph/cody.json'), false);
    assert.equal(r.touched.includes('.zed/settings.json'), false);
    // CONTROL: AGENTS.md WAS written on this same run, so the assertions
    // above mean "left alone", not "applyToRepo did nothing".
    assert.ok(r.touched.includes('AGENTS.md'), 'control: AGENTS.md must be touched');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('#265: idempotence repro — three runs, byte-identical after the first', async () => {
  // The brief's explicit ask: "Running the command twice must be idempotent.
  // Prove it: run it, run it again, diff."
  const files = {
    'AGENTS.md': '# AGENTS.md\n\nProject overview the humans own.\n',
    'CLAUDE.md': '# CLAUDE\n\nhand-written\n',
    'GEMINI.md': '# gemini\n',
    '.github/copilot-instructions.md': '# copilot\n',
    '.cursorrules': '# my rules\n\n<!-- clud-bug-start -->\nSTALE\n<!-- clud-bug-end -->\n\ntrailing note\n',
    '.windsurfrules': '# windsurf\n',
    '.clinerules': '# cline\n',
    '.continuerules': '# continue\n',
    '.cursor/rules/general.md': '---\ndescription: x\n---\n\n# general\n',
  };
  const paths = Object.keys(files);
  const dir = await makeRepo(files);
  try {
    const opts = { version: '0.7.0', strictMode: true };
    await applyToRepo(dir, opts);
    const snap1 = {};
    for (const p of paths) snap1[p] = await readFile(join(dir, p), 'utf8');

    const r2 = await applyToRepo(dir, opts);
    const snap2 = {};
    for (const p of paths) snap2[p] = await readFile(join(dir, p), 'utf8');

    const r3 = await applyToRepo(dir, opts);
    const snap3 = {};
    for (const p of paths) snap3[p] = await readFile(join(dir, p), 'utf8');

    for (const p of paths) {
      assert.equal(snap2[p], snap1[p], `run 2 changed ${p}`);
      assert.equal(snap3[p], snap1[p], `run 3 changed ${p}`);
    }
    // Nothing reported as written after the first run — a no-op run must not
    // dirty a tracked file (the sibling complaint in #265).
    assert.deepEqual(r2.touched, [], 'run 2 wrote files');
    assert.deepEqual(r3.touched, [], 'run 3 wrote files');
    assert.deepEqual(r2.created, []);
    // Exactly one stub per per-tool file, no accumulation.
    for (const p of paths.filter((x) => x !== 'AGENTS.md')) {
      assert.equal((snap3[p].match(/<!-- clud-bug-stub:/g) || []).length, 1, `${p} stub count`);
    }
    // The stale block is gone and the note that followed it survived.
    assert.doesNotMatch(snap3['.cursorrules'], /STALE/);
    assert.match(snap3['.cursorrules'], /trailing note/);
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

// SUPERSEDED by #265. This slot used to hold
// 'applyToRepo: STILL installs block into CLAUDE.md when @AGENTS.md import is
// absent', which pinned the copy-into-per-tool-file behaviour as intentional
// back-compat. §1.1/§1.2 forbid it, so the contract is now the inverse: no
// import means a stub, not a block.
test('#265: CLAUDE.md without an @AGENTS.md import gets a stub, not a block', async () => {
  const dir = await makeRepo({
    'AGENTS.md': '# AGENTS.md\n',
    'CLAUDE.md': '# CLAUDE.md\n\nstuff\n',
  });
  try {
    await applyToRepo(dir, { version: '0.6.18', strictMode: true });
    const claude = await readFile(join(dir, 'CLAUDE.md'), 'utf8');
    assert.doesNotMatch(claude, /<!-- clud-bug-start -->/);
    assert.match(claude, /<!-- clud-bug-stub:/);
    assert.match(claude, /stuff/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('applyToRepo: .cursor/rules/*.md — import satisfies the redirect, absence earns a stub', async () => {
  const dir = await makeRepo({
    'AGENTS.md': '# AGENTS.md\n',
    '.cursor/rules/general.md': '@AGENTS.md\n\n# general\n',
    '.cursor/rules/no-import.md': '# no import\n',
  });
  try {
    const r = await applyToRepo(dir, { strictMode: true });
    const general = await readFile(join(dir, '.cursor/rules/general.md'), 'utf8');
    const noImport = await readFile(join(dir, '.cursor/rules/no-import.md'), 'utf8');
    // Neither gets a block (#265).
    assert.doesNotMatch(general, /<!-- clud-bug-start -->/);
    assert.doesNotMatch(noImport, /<!-- clud-bug-start -->/);
    // The @-import already redirects — untouched, no second pointer.
    assert.doesNotMatch(general, /clud-bug-stub/);
    assert.equal(r.touched.includes('.cursor/rules/general.md'), false);
    // The other has no pointer at all, so it earns a stub.
    assert.match(noImport, /<!-- clud-bug-stub:/);
    assert.ok(r.touched.includes('.cursor/rules/no-import.md'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// --- #265: regression guards on the helpers the change reaches into ---------

test('upsertBlock: preserves content after the end marker (non-greedy)', () => {
  // The code comment used to claim this replace was "greedy". It is not —
  // `[\s\S]*?` stops at the FIRST end marker. If someone "fixes" the comment
  // by making the regex actually greedy, everything between the first start
  // marker and the LAST end marker is eaten. This test is the tripwire.
  const before = [
    'HEAD',
    '<!-- clud-bug-start -->', 'OLD', '<!-- clud-bug-end -->',
    'MIDDLE',
    '<!-- clud-bug-start -->', 'SECOND', '<!-- clud-bug-end -->',
    'TAIL', '',
  ].join('\n');
  const after = upsertBlock(before, '<!-- clud-bug-start -->\nNEW\n<!-- clud-bug-end -->');
  assert.match(after, /HEAD/);
  assert.match(after, /NEW/);
  assert.doesNotMatch(after, /OLD/);
  assert.match(after, /MIDDLE/, 'content between the two blocks was eaten');
  assert.match(after, /SECOND/, 'the second block was eaten');
  assert.match(after, /TAIL/, 'content after the end marker was eaten');
});

test('removeBlock: strips EVERY block, not just the first', () => {
  // A bad merge of two branches that each ran init can leave two copies.
  // "MUST NOT carry a copy" is not satisfied by removing one of them.
  const before = 'HEAD\n\n<!-- clud-bug-start -->\nA\n<!-- clud-bug-end -->\nMIDDLE\n\n<!-- clud-bug-start -->\nB\n<!-- clud-bug-end -->\nTAIL\n';
  const after = removeBlock(before);
  assert.doesNotMatch(after, /clud-bug-start/);
  assert.doesNotMatch(after, /clud-bug-end/);
  assert.doesNotMatch(after, /\bA\b/);
  assert.doesNotMatch(after, /\bB\b/);
  assert.equal(removeBlock(after), after, 'idempotent');
});

test('removeBlock: does NOT weld together the lines a block sat between', () => {
  // Regression. The old replacement was '', which was only safe while the
  // block was always the last thing in the file. With per-tool files now
  // stripped in place, 'HEAD\n\n<block>\nMIDDLE' collapsed to 'HEADMIDDLE' —
  // two unrelated user lines silently merged into one.
  const before = 'HEAD\n\n<!-- clud-bug-start -->\nA\n<!-- clud-bug-end -->\nMIDDLE\n\n<!-- clud-bug-start -->\nB\n<!-- clud-bug-end -->\nTAIL\n';
  assert.equal(removeBlock(before), 'HEAD\n\nMIDDLE\n\nTAIL\n');
  assert.doesNotMatch(removeBlock(before), /HEADMIDDLE/);
});

test('removeBlock: leaves exactly one blank line where a block sat between paragraphs', () => {
  // Blank line on BOTH sides of the block. The old trailing `\n?` consumed
  // only one of the two newlines after the end marker, leaving a doubled
  // blank line — a visible dent in a file we are supposed to tidy.
  const before = '# rules\n\nAlways use tabs.\n\n<!-- clud-bug-start -->\nx\n<!-- clud-bug-end -->\n\ntrailing note I wrote\n';
  assert.equal(removeBlock(before), '# rules\n\nAlways use tabs.\n\ntrailing note I wrote\n');
  assert.doesNotMatch(removeBlock(before), /\n\n\n/);
});

test('removeBlock: keeps the file newline-terminated when the block ends it', () => {
  assert.equal(
    removeBlock('# rules\n\nAlways use tabs.\n\n<!-- clud-bug-start -->\nx\n<!-- clud-bug-end -->\n'),
    '# rules\n\nAlways use tabs.\n',
  );
  // Block IS the whole file → empty, not a stray newline.
  assert.equal(removeBlock('<!-- clud-bug-start -->\nx\n<!-- clud-bug-end -->\n'), '');
});

test('renderStub: matches the §1.2 form — one marker line plus a two-line pointer', () => {
  const stub = renderStub(0);
  const lines = stub.split('\n');
  assert.equal(lines.length, 3, `stub should be 3 lines, got ${lines.length}`);
  assert.match(lines[0], /^<!-- clud-bug-stub: .* -->$/);
  assert.match(stub, /See \[AGENTS\.md\]\(AGENTS\.md\)/);
  // It is a pointer, not a copy: none of the block's substance appears.
  assert.doesNotMatch(stub, /Strict mode/);
  assert.doesNotMatch(stub, /clud-bug-collaboration/);
  // We do NOT write logmind's marker — that region belongs to logmind (§1.1).
  assert.doesNotMatch(stub, /logmind-stub/);
});

test('hasAgentsMdRedirect: recognises every redirect form, rejects prose', () => {
  assert.equal(hasAgentsMdRedirect('@AGENTS.md\n'), true);
  assert.equal(hasAgentsMdRedirect('<!-- logmind-stub: x -->\n'), true);
  assert.equal(hasAgentsMdRedirect('<!-- clud-bug-stub: x -->\n'), true);
  assert.equal(hasAgentsMdRedirect('See [AGENTS.md](AGENTS.md).\n'), true);
  assert.equal(hasAgentsMdRedirect('See [AGENTS.md](../AGENTS.md).\n'), true);
  assert.equal(hasAgentsMdRedirect('See [AGENTS.md](../../AGENTS.md).\n'), true);
  // CONTROL — these must NOT count, or every file would look redirected.
  assert.equal(hasAgentsMdRedirect('read AGENTS.md sometime\n'), false);
  assert.equal(hasAgentsMdRedirect('# rules\n'), false);
  assert.equal(hasAgentsMdRedirect(''), false);
  assert.equal(hasAgentsMdRedirect(null), false);
});

test('#265: a CRLF per-tool file stays CRLF and gains no blank-line dent', async () => {
  // Windows checkouts. Before the fix, `\n*` matched only the `\n` half of
  // each CRLF and stranded the `\r`s, so stripping a block from a CRLF
  // .cursorrules produced '# my rules\r\n\r\n\n\r\n\r\ntrailing' — three
  // blank lines where there had been one. Content preserved, file mangled.
  const crlf = '# my rules\r\n\r\n<!-- clud-bug-start -->\r\nBLOCK\r\n<!-- clud-bug-end -->\r\n\r\ntrailing note\r\n';
  assert.equal(removeBlock(crlf), '# my rules\r\n\r\ntrailing note\r\n');

  const dir = await makeRepo({ 'AGENTS.md': '# AGENTS.md\n', '.cursorrules': crlf });
  try {
    await applyToRepo(dir, { version: '0.7.0', strictMode: true });
    const out = await readFile(join(dir, '.cursorrules'), 'utf8');
    assert.doesNotMatch(out, /clud-bug-start/);
    assert.match(out, /# my rules/);
    assert.match(out, /trailing note/);
    // No lone \r, and no LF that isn't part of a CRLF — line endings stayed uniform.
    assert.doesNotMatch(out, /\r(?!\n)/, 'stray carriage return');
    assert.doesNotMatch(out, /(?<!\r)\n/, 'LF smuggled into a CRLF file');
    // Idempotent on CRLF too.
    await applyToRepo(dir, { version: '0.7.0', strictMode: true });
    assert.equal(await readFile(join(dir, '.cursorrules'), 'utf8'), out);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('insertStub: never disturbs bytes it did not write', () => {
  const stub = renderStub(0);
  const body = '# rules\n\nAlways use tabs.\n';
  const out = insertStub(body, stub);
  assert.ok(out.startsWith(stub), 'stub leads a frontmatter-less file');
  assert.ok(out.endsWith(body), 'original body preserved byte-for-byte');
  // Empty file → just the stub, no leading blank line.
  assert.equal(insertStub('', stub), `${stub}\n`);
});

// v0.6.25 / gotcha #2 — publisher SKILL.md path detection.
test('detectSkillRelPath: returns consumer path when skill source is absent', async () => {
  const dir = await makeRepo({});
  try {
    const path = await detectSkillRelPath(dir);
    assert.equal(path, '.claude/skills/clud-bug-collaboration/SKILL.md');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('detectSkillRelPath: returns publisher path when skills/clud-bug-collaboration/SKILL.md exists', async () => {
  // agent-skills is the canonical publisher: skill source lives at
  // `skills/clud-bug-collaboration/SKILL.md`. Rendering the consumer
  // path into AGENTS.md broke check-links every prior propagation
  // cycle (manual fix per cycle). Fixed in v0.6.25.
  const dir = await makeRepo({
    'skills/clud-bug-collaboration/SKILL.md': '# clud-bug-collaboration skill source\n',
  });
  try {
    const path = await detectSkillRelPath(dir);
    assert.equal(path, 'skills/clud-bug-collaboration/SKILL.md');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('renderBlock: skillRelPath override changes the link target', () => {
  const consumer = renderBlock({ version: '0.6.25', strictMode: true });
  assert.match(consumer, /\.claude\/skills\/clud-bug-collaboration\/SKILL\.md/);

  const publisher = renderBlock({
    version: '0.6.25',
    strictMode: true,
    skillRelPath: 'skills/clud-bug-collaboration/SKILL.md',
  });
  assert.match(publisher, /\]\(skills\/clud-bug-collaboration\/SKILL\.md\)/);
  // ensure publisher form doesn't accidentally retain the consumer prefix
  assert.doesNotMatch(publisher, /\.claude\/skills\/clud-bug-collaboration\/SKILL\.md/);
});

test('applyToRepo: auto-uses publisher path when skill source detected (end-to-end)', async () => {
  const dir = await makeRepo({
    'AGENTS.md': '# project\n',
    'skills/clud-bug-collaboration/SKILL.md': '# source\n',
  });
  try {
    await applyToRepo(dir, { version: '0.6.25', strictMode: false });
    const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8');
    assert.match(agents, /\]\(skills\/clud-bug-collaboration\/SKILL\.md\)/);
    assert.doesNotMatch(agents, /\.claude\/skills\/clud-bug-collaboration\/SKILL\.md/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
