// Tests for src/core/roster.ts — the agent roster reader (SPEC §2.4,
// clud-bug#268 / agent-skills#180). `readRoster(repoRoot)` parses every
// `.claude/agents/*.md` frontmatter into a `RosterEntry`, or reports why it
// couldn't in `problems` — never a silent drop.

import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { readRoster, parseRosterEntry } from '../../src/core/roster.js';

const FIXTURES = resolve(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'fixtures', 'agents');

describe('readRoster — fixtures', () => {
  it('valid: parses name/description/tools/model/color/trigger + the repo-relative file', async () => {
    const { entries, problems } = await readRoster(join(FIXTURES, 'valid'));
    expect(problems).toEqual([]);
    expect(entries).toEqual([
      {
        name: 'beetle',
        description: 'Fast first-pass reviewer — broad recall scan of the diff.',
        tools: 'Read, Grep, Bash',
        model: 'anthropic/claude-sonnet-4.6',
        color: 'green',
        trigger: 'on-demand',
        file: '.claude/agents/beetle.md',
      },
    ]);
  });

  it('missing-name: reported as a problem naming the file, never silently dropped', async () => {
    const { entries, problems } = await readRoster(join(FIXTURES, 'missing-name'));
    expect(entries).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0].file).toBe('.claude/agents/no-name.md');
    expect(problems[0].reason).toMatch(/name/i);
  });

  it('bad-yaml: reported as a problem, not thrown', async () => {
    const { entries, problems } = await readRoster(join(FIXTURES, 'bad-yaml'));
    expect(entries).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0].file).toBe('.claude/agents/broken.md');
  });

  it('tier-field: rejected — §2.4 "a role names a model directly", not a cost bracket', async () => {
    const { entries, problems } = await readRoster(join(FIXTURES, 'tier-field'));
    expect(entries).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0].file).toBe('.claude/agents/legacy.md');
    expect(problems[0].reason).toMatch(/tier/i);
  });

  it('name-mismatch: the declared name must equal its filename', async () => {
    const { entries, problems } = await readRoster(join(FIXTURES, 'name-mismatch'));
    expect(entries).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0].file).toBe('.claude/agents/foo.md');
    expect(problems[0].reason).toMatch(/foo/);
  });

  it('extra-unknown-field: accepted — an unrecognised field does not sink an otherwise-valid entry', async () => {
    const { entries, problems } = await readRoster(join(FIXTURES, 'extra-unknown-field'));
    expect(problems).toEqual([]);
    expect(entries).toEqual([
      {
        name: 'quirky',
        description: "A valid role that also carries a field this reader doesn't know.",
        model: 'anthropic/claude-opus-4.7',
        file: '.claude/agents/quirky.md',
      },
    ]);
  });
});

describe('readRoster — directory-level behavior', () => {
  it('an absent .claude/agents directory is an empty roster, not an error (SPEC §2.4)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clud-bug-roster-'));
    await expect(readRoster(dir)).resolves.toEqual({ entries: [], problems: [] });
  });

  it('one malformed file does not block a valid sibling from loading', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clud-bug-roster-'));
    const agentsDir = join(dir, '.claude', 'agents');
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, 'good.md'),
      '---\nname: good\ndescription: A fine role.\n---\n\nbody',
    );
    await writeFile(join(agentsDir, 'bad.md'), '---\ndescription: no name here\n---\n\nbody');

    const { entries, problems } = await readRoster(dir);
    expect(entries).toEqual([
      { name: 'good', description: 'A fine role.', file: '.claude/agents/good.md' },
    ]);
    expect(problems).toEqual([
      { file: '.claude/agents/bad.md', reason: 'missing required `name` field' },
    ]);
  });

  it('ignores non-.md files under .claude/agents', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clud-bug-roster-'));
    const agentsDir = join(dir, '.claude', 'agents');
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, 'README.txt'), 'not a role file');
    await expect(readRoster(dir)).resolves.toEqual({ entries: [], problems: [] });
  });
});

// ---------------------------------------------------------------------------
// parseRosterEntry — the pure per-file parser readRoster is built on.
// ---------------------------------------------------------------------------

describe('parseRosterEntry', () => {
  it('never executes or exposes the body — only frontmatter fields land on the entry', () => {
    const raw =
      '---\nname: x\ndescription: y\n---\n\nrm -rf / #pretend this is instructions, never read as code';
    const result = parseRosterEntry(raw, 'x', '.claude/agents/x.md');
    expect('entry' in result).toBe(true);
    expect(Object.values(result.entry).join(' ')).not.toMatch(/rm -rf/);
  });

  it('tolerates quoted scalar values', () => {
    const raw = '---\nname: "x"\ndescription: \'a quoted description\'\n---\n\nbody';
    const result = parseRosterEntry(raw, 'x', '.claude/agents/x.md');
    expect(result.entry).toMatchObject({ name: 'x', description: 'a quoted description' });
  });
});
