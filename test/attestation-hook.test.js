// #266 — the HARNESS ATTESTATION hooks (SPEC 2.0 §4.4): the two Claude Code
// entries whose registration lives in the repository's committed
// `.claude/settings.json`, and the records they write.
//
// The fixtures below are the payload SHAPES Claude Code documents for
// `PostToolUse` on the `Agent` tool (dispatch: `tool_response.agentId` +
// `resolvedModel`, `tool_use_id`) and for `SubagentStop` (completion:
// `agent_id`, `agent_type`) — the two rows are joined on `agent_id` because
// subagents run in the background, so the dispatch event is the only one
// carrying the resolved model and the completion event is the only one that
// means the reviewer actually finished.
//
// The suites run the hook command the way Claude Code does: `sh -c "$command"`
// with the event JSON on stdin, inside a REAL `git init` repo (the writer keys
// its store off `git rev-parse --git-common-dir`).

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, access, chmod, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  ATTEST_FILE,
  ATTESTATION_HOOK_MARKER,
  REVIEWER_AGENT_TYPE,
  buildAttestDispatchCommand,
  buildAttestCompletionCommand,
  buildAttestDispatchHook,
  buildAttestCompletionHook,
  buildReviewerAgentFile,
  buildCommitReviewCommand,
  mergeLocalReviewHook,
} from '../src/cli/hooks.js';
import { runUpdate } from '../src/cli/update.js';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(REPO_ROOT, 'bin', 'clud-bug.js');
const TEMPLATES = join(REPO_ROOT, 'templates');
const BASELINE = join(TEMPLATES, 'skills', 'baseline');
// Forced through to loadBaseline so this doesn't hit the live agent-skills
// repo or write to the user's real ~/.cache/clud-bug/skills/ dir (mirrors
// test/update.test.js).
const offlineLoadBaseline = { cacheDir: null, fetch: async () => { throw new Error('test: no network'); } };
const COMMIT_REVIEW_COMMAND = buildCommitReviewCommand();

/** A prompt long enough that any 24-char window of it is a real fingerprint —
 * §4.4:959 "The prompt text itself MUST NOT be recorded". */
const SECRET_PROMPT =
  'REVIEW STRATEGY: probe the nonce-spend path for a double-spend window, then ' +
  'diff the committed ruleset against the fetched one and refute the change.';

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-attest-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@test']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

/** Run a hook command the way Claude Code does: `sh -c`, event JSON on stdin. */
function runHook(command, cwd, event) {
  return spawnSync('sh', ['-c', command], {
    cwd,
    encoding: 'utf8',
    input: typeof event === 'string' ? event : JSON.stringify(event ?? {}),
    env: { ...process.env },
  });
}

/** The documented `PostToolUse` payload for a backgrounded `Agent` launch. */
function dispatchEvent(overrides = {}) {
  return {
    session_id: 'abc123',
    transcript_path: '/tmp/abc123.jsonl',
    cwd: '/repo',
    permission_mode: 'default',
    hook_event_name: 'PostToolUse',
    effort: { level: 'xhigh' },
    tool_name: 'Agent',
    tool_input: {
      description: 'Refute-first pass on the notary boundary',
      prompt: SECRET_PROMPT,
      subagent_type: REVIEWER_AGENT_TYPE,
      model: 'opus',
    },
    tool_response: {
      status: 'async_launched',
      agentId: 'a4d2c8f1e0b3a297',
      description: 'Refute-first pass on the notary boundary',
      prompt: SECRET_PROMPT,
      outputFile: '/tmp/out.md',
      resolvedModel: 'claude-opus-5',
    },
    tool_use_id: 'toolu_01ABC123',
    duration_ms: 12,
    ...overrides,
  };
}

/** The documented `SubagentStop` payload. */
function completionEvent(overrides = {}) {
  return {
    session_id: 'abc123',
    transcript_path: '/tmp/abc123.jsonl',
    cwd: '/repo',
    permission_mode: 'default',
    hook_event_name: 'SubagentStop',
    effort: { level: 'xhigh' },
    stop_hook_active: false,
    agent_id: 'a4d2c8f1e0b3a297',
    agent_type: REVIEWER_AGENT_TYPE,
    agent_transcript_path: '/tmp/abc123/subagents/agent-a4d2c8f1e0b3a297.jsonl',
    last_assistant_message: 'Critical: the nonce is spent before the diff is fetched.',
    background_tasks: [],
    session_crons: [],
    ...overrides,
  };
}

async function readStore(gitCommonDir) {
  const raw = await readFile(join(gitCommonDir, ATTEST_FILE), 'utf8');
  return raw
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

describe('#266 attestation hook — the dispatch row (PostToolUse on Agent)', () => {
  it('writes one dispatch row carrying every §4.4 field the harness provides', async () => {
    const dir = await makeRepo();
    const r = runHook(buildAttestDispatchCommand(), dir, dispatchEvent());
    expect(r.status).toBe(0);

    const rows = await readStore(join(dir, '.git'));
    expect(rows).toHaveLength(1);
    const rec = rows[0];
    expect(rec.schema).toBe('clud-bug/attestation@1');
    expect(rec.phase).toBe('dispatch');
    // §4.4:957 — the harness's identifier, the role, the RESOLVED model, the
    // resolved effort, the dispatching call, and a lens label or digest.
    expect(rec.agent_id).toBe('a4d2c8f1e0b3a297');
    expect(rec.role).toBe(REVIEWER_AGENT_TYPE);
    expect(rec.resolved_model).toBe('claude-opus-5'); // never tool_input.model ("opus")
    expect(rec.effort).toBe('xhigh');
    expect(rec.dispatch_ref).toBe('toolu_01ABC123');
    expect(rec.lens_label).toBe('Refute-first pass on the notary boundary');
    expect(rec.lens_digest).toMatch(/^sha256:[0-9a-f]{32}$/);
    expect(rec.head_sha).toBe(git(dir, ['rev-parse', 'HEAD']));
  });

  it('never records the requested alias in place of the resolved model (§4.4:957)', async () => {
    const dir = await makeRepo();
    const ev = dispatchEvent();
    delete ev.tool_response.resolvedModel;
    expect(runHook(buildAttestDispatchCommand(), dir, ev).status).toBe(0);
    const [rec] = await readStore(join(dir, '.git'));
    // `tool_input.model` is still "opus" in the payload — a missing resolved
    // model is reported as missing, never backfilled from the alias.
    expect(rec.resolved_model).toBe(null);
    expect(rec.resolved_model_source).toBe('unavailable');
    expect(JSON.stringify(rec)).not.toContain('"opus"');
  });

  it('records `models_used` when the harness swapped models mid-run', async () => {
    const dir = await makeRepo();
    const ev = dispatchEvent();
    ev.tool_response.modelsUsed = ['claude-opus-5', 'claude-haiku-4-5'];
    expect(runHook(buildAttestDispatchCommand(), dir, ev).status).toBe(0);
    const [rec] = await readStore(join(dir, '.git'));
    expect(rec.models_used).toEqual(['claude-opus-5', 'claude-haiku-4-5']);
  });

  it('§4.4:959 — the prompt text is NEVER recorded, only its digest', async () => {
    const dir = await makeRepo();
    expect(runHook(buildAttestDispatchCommand(), dir, dispatchEvent()).status).toBe(0);
    const line = await readFile(join(dir, '.git', ATTEST_FILE), 'utf8');
    // No 24-char window of the prompt may appear anywhere in the record — the
    // prompt rides on BOTH `tool_input.prompt` and (for a backgrounded launch)
    // `tool_response.prompt`, so a field-name allowlist is what has to hold.
    for (let i = 0; i + 24 <= SECRET_PROMPT.length; i++) {
      expect(line).not.toContain(SECRET_PROMPT.slice(i, i + 24));
    }
    // …and the digest still distinguishes one lens from another.
    const first = JSON.parse(line.split('\n')[0]).lens_digest;
    const other = dispatchEvent();
    other.tool_input.prompt = SECRET_PROMPT + ' (second lens)';
    other.tool_response.agentId = 'b111111111111111';
    expect(runHook(buildAttestDispatchCommand(), dir, other).status).toBe(0);
    const rows = await readStore(join(dir, '.git'));
    expect(rows[1].lens_digest).not.toBe(first);
  });

  it('§4.4:961 — the command makes no network call', () => {
    for (const cmd of [buildAttestDispatchCommand(), buildAttestCompletionCommand()]) {
      expect(cmd).not.toMatch(/\bnpx\b/);
      expect(cmd).not.toMatch(/\bcurl\b/);
      expect(cmd).not.toMatch(/\bwget\b/);
      expect(cmd).not.toMatch(/\bfetch\b/);
      expect(cmd).not.toMatch(/https?:\/\//);
    }
  });

  it('#240 vector 1 — a dispatch from a LINKED worktree lands in the shared common dir', async () => {
    const dir = await makeRepo();
    const wt = join(dir, '..', `wt-${Date.now()}`);
    git(dir, ['worktree', 'add', '-q', '-b', 'side', wt]);
    expect(runHook(buildAttestDispatchCommand(), wt, dispatchEvent()).status).toBe(0);
    // The store is the ONE location every linked worktree shares — never the
    // worktree-local `.git/worktrees/<name>` a `--git-dir` read would give.
    const rows = await readStore(join(dir, '.git'));
    expect(rows).toHaveLength(1);
    expect(rows[0].agent_id).toBe('a4d2c8f1e0b3a297');
    await expect(access(join(dir, '.git', 'worktrees', `wt-${Date.now()}`, ATTEST_FILE))).rejects.toThrow();
  });
});

describe('#266 attestation hook — the completion row (SubagentStop)', () => {
  it('writes a completed row joined to the dispatch row by agent_id', async () => {
    const dir = await makeRepo();
    expect(runHook(buildAttestDispatchCommand(), dir, dispatchEvent()).status).toBe(0);
    expect(runHook(buildAttestCompletionCommand(), dir, completionEvent()).status).toBe(0);
    const rows = await readStore(join(dir, '.git'));
    expect(rows.map((r) => r.phase)).toEqual(['dispatch', 'completed']);
    expect(rows[1].agent_id).toBe(rows[0].agent_id);
    expect(rows[1].role).toBe(REVIEWER_AGENT_TYPE);
    expect(rows[1].head_sha).toBe(git(dir, ['rev-parse', 'HEAD']));
  });

  it('never records the subagent final message (it carries quoted source)', async () => {
    const dir = await makeRepo();
    expect(runHook(buildAttestCompletionCommand(), dir, completionEvent()).status).toBe(0);
    const line = await readFile(join(dir, '.git', ATTEST_FILE), 'utf8');
    expect(line).not.toContain('the nonce is spent');
    expect(line).not.toContain('agent_transcript_path');
  });
});

describe('#266 attestation hook — store growth', () => {
  /** A well-formed row short enough that a thousand of them are ~110 KB: the
   * compaction rule counts LINES, so a store that is long but small must still
   * be compacted. */
  function shortRow(i) {
    return JSON.stringify({
      schema: 'clud-bug/attestation@1',
      phase: 'completed',
      agent_id: `a${i}`,
      role: REVIEWER_AGENT_TYPE,
      head_sha: 'x',
    });
  }

  async function seedLines(dir, n) {
    const rows = Array.from({ length: n }, (_, i) => shortRow(i));
    await writeFile(join(dir, '.git', ATTEST_FILE), rows.join('\n') + '\n');
  }

  it('rewrites to the newest 500 rows once the append passes 1000 lines', async () => {
    const dir = await makeRepo();
    await seedLines(dir, 1000);
    expect(runHook(buildAttestCompletionCommand(), dir, completionEvent()).status).toBe(0);
    const rows = await readStore(join(dir, '.git'));
    expect(rows).toHaveLength(500);
    // The NEWEST survive: the row this hook just wrote is last, and the oldest
    // 501 are the ones dropped.
    expect(rows[rows.length - 1].agent_id).toBe('a4d2c8f1e0b3a297');
    expect(rows[0].agent_id).toBe('a501');
  });

  it('leaves a store that reaches exactly 1000 lines alone', async () => {
    const dir = await makeRepo();
    await seedLines(dir, 999);
    expect(runHook(buildAttestCompletionCommand(), dir, completionEvent()).status).toBe(0);
    expect(await readStore(join(dir, '.git'))).toHaveLength(1000);
  });
});

describe('#266 attestation hook — it can never block or fail a session', () => {
  // §8.1:1507 is a claim about what is VISIBLE in the diff, not about a hook
  // that gets to wedge a subagent: a SubagentStop hook CAN block (Claude Code
  // docs), so ours must exit 0 on every path there is.
  const cases = [
    ['unparseable stdin', 'not json at all {{{'],
    ['empty stdin', ''],
    ['an event with no tool_response', { hook_event_name: 'PostToolUse', tool_input: {} }],
    ['an event with no agent id', dispatchEvent({ tool_response: { resolvedModel: 'x' } })],
    ['a null event', 'null'],
  ];
  for (const [label, ev] of cases) {
    it(`exits 0 on ${label}`, async () => {
      const dir = await makeRepo();
      for (const cmd of [buildAttestDispatchCommand(), buildAttestCompletionCommand()]) {
        expect(runHook(cmd, dir, ev).status).toBe(0);
      }
    });
  }

  it('exits 0 outside a git repository', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clud-bug-nogit-'));
    for (const cmd of [buildAttestDispatchCommand(), buildAttestCompletionCommand()]) {
      const r = runHook(cmd, dir, dispatchEvent());
      expect(r.status).toBe(0);
    }
  });

  it('exits 0 when the store cannot be written', async () => {
    const dir = await makeRepo();
    await chmod(join(dir, '.git'), 0o500);
    try {
      expect(runHook(buildAttestDispatchCommand(), dir, dispatchEvent()).status).toBe(0);
    } finally {
      await chmod(join(dir, '.git'), 0o755);
    }
  });
});

describe('#266 mergeLocalReviewHook — both registrations, in the committed settings', () => {
  it('installs the PostToolUse(Agent) dispatch entry and the SubagentStop completion entry', () => {
    const s = mergeLocalReviewHook(undefined, COMMIT_REVIEW_COMMAND);
    const dispatch = s.hooks.PostToolUse.find((e) => e.matcher === 'Agent');
    expect(dispatch.hooks[0].command).toContain(ATTESTATION_HOOK_MARKER);
    expect(dispatch.hooks[0].async).toBe(true); // never delays the session
    expect(dispatch.hooks[0].asyncRewake).toBeUndefined(); // says nothing back
    // §4.4's filter is HARNESS-side: the matcher is the reviewer agent type, so
    // an unrelated subagent's completion can never become a review record.
    const completion = s.hooks.SubagentStop.find((e) => e.matcher === REVIEWER_AGENT_TYPE);
    expect(completion.hooks[0].command).toContain(ATTESTATION_HOOK_MARKER);
    expect(completion.hooks[0].async).toBe(true);
  });

  it('is idempotent across re-runs on both events', () => {
    const once = mergeLocalReviewHook(undefined, COMMIT_REVIEW_COMMAND);
    const twice = mergeLocalReviewHook(once, COMMIT_REVIEW_COMMAND);
    expect(twice.hooks.PostToolUse).toHaveLength(once.hooks.PostToolUse.length);
    expect(twice.hooks.SubagentStop).toHaveLength(1);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('preserves a foreign SubagentStop entry and a user hook co-located in ours', () => {
    const existing = {
      hooks: {
        SubagentStop: [
          { matcher: 'Explore', hooks: [{ type: 'command', command: './theirs.sh' }] },
          {
            matcher: REVIEWER_AGENT_TYPE,
            hooks: [
              { type: 'command', command: `# ${ATTESTATION_HOOK_MARKER} v0 stale` },
              { type: 'command', command: './mine-too.sh' },
            ],
          },
        ],
      },
    };
    const s = mergeLocalReviewHook(existing, COMMIT_REVIEW_COMMAND);
    expect(s.hooks.SubagentStop.some((e) => e.matcher === 'Explore')).toBe(true);
    const ours = s.hooks.SubagentStop.find((e) => e.matcher === REVIEWER_AGENT_TYPE);
    expect(ours.hooks.map((h) => h.command)).toContain('./mine-too.sh');
    expect(ours.hooks.filter((h) => h.command.includes(ATTESTATION_HOOK_MARKER))).toHaveLength(1);
    expect(ours.hooks.some((h) => h.command.includes('v0 stale'))).toBe(false);
  });

  it('keeps the commit-review entry first and adds the attestation entry beside it', () => {
    const s = mergeLocalReviewHook(undefined, COMMIT_REVIEW_COMMAND);
    expect(s.hooks.PostToolUse[0].matcher).toBe('Bash');
    expect(s.hooks.PostToolUse).toHaveLength(2);
  });
});

describe('#266 the reviewer agent file', () => {
  it('declares the subagent type the SubagentStop matcher filters on', () => {
    const body = buildReviewerAgentFile();
    expect(body).toMatch(new RegExp(`^---\\nname: ${REVIEWER_AGENT_TYPE}\\n`));
    expect(body).toContain('<!-- clud-bug-agent-version:');
  });

  it('carries no review instructions of its own (the recipe is the one owner)', () => {
    // A second copy of the lens/grounding rules here would rot against
    // review-prompt.ts, which is where the recipe actually lives.
    const body = buildReviewerAgentFile();
    expect(body).not.toMatch(/grounding_kind|critical_findings|summary_counts/);
  });

  it('pins no `model:` — every dispatch names its own model', () => {
    // A `model:` key here would bind every pass to one model whatever the
    // recipe asked for, which is how a 3-tier panel silently becomes one tier
    // — and the resolved model is exactly what the dispatch row records.
    expect(buildReviewerAgentFile()).not.toMatch(/^model:/m);
  });
});

describe('#266 install — the registration lives in the committed settings (§4.4:961)', () => {
  function runInit(dir, extraArgs) {
    return spawnSync(
      process.execPath,
      [CLI, 'init', '--offline', '--accept-all', '--no-set-protection', ...extraArgs],
      { cwd: dir, env: { ...process.env, HOME: dir, CLUD_BUG_QUIET: '1' }, encoding: 'utf8', timeout: 30000 },
    );
  }

  it('init --hook-trigger commit writes both entries and the agent file', async () => {
    const dir = await makeRepo();
    const r = runInit(dir, ['--with-hooks', '--hook-trigger', 'commit']);
    expect(r.status).toBe(0);
    const settings = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf8'));
    expect(settings.hooks.PostToolUse.some((e) => e.matcher === 'Agent')).toBe(true);
    expect(settings.hooks.SubagentStop[0].matcher).toBe(REVIEWER_AGENT_TYPE);
    const agent = await readFile(join(dir, '.claude', 'agents', `${REVIEWER_AGENT_TYPE}.md`), 'utf8');
    expect(agent).toContain(`name: ${REVIEWER_AGENT_TYPE}`);
    expect(agent).not.toMatch(/^model:/m);
  });

  it('init installs the registration even on the pre-push-only default surface', async () => {
    // The attestation records WHICH REASONERS RAN; that is independent of which
    // trigger surfaced the recipe, and §4.4 makes the committed registration the
    // whole tamper-evidence argument — so it cannot be gated on a hook trigger.
    const dir = await makeRepo();
    expect(runInit(dir, []).status).toBe(0);
    const settings = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf8'));
    expect(settings.hooks.SubagentStop[0].hooks[0].command).toContain(ATTESTATION_HOOK_MARKER);
    await access(join(dir, '.claude', 'agents', `${REVIEWER_AGENT_TYPE}.md`));
  });

  it('update retrofits an installed repo that predates the attestation', async () => {
    const dir = await makeRepo();
    expect(runInit(dir, ['--with-hooks', '--hook-trigger', 'commit']).status).toBe(0);

    // Roll the install back to its pre-#266 shape: the commit-review entry
    // alone, no SubagentStop event, no agent file. Anyone who ran `init` before
    // this shipped is in exactly this state, and `update` is how they leave it.
    const settingsPath = join(dir, '.claude', 'settings.json');
    await writeFile(
      settingsPath,
      JSON.stringify(
        { hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: COMMIT_REVIEW_COMMAND }] }] } },
        null,
        2,
      ) + '\n',
    );
    await rm(join(dir, '.claude', 'agents'), { recursive: true, force: true });

    const r = spawnSync(process.execPath, [CLI, 'update', '--offline'], {
      cwd: dir,
      env: { ...process.env, HOME: dir, CLUD_BUG_QUIET: '1' },
      encoding: 'utf8',
      timeout: 60000,
    });
    expect(r.status).toBe(0);
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    expect(settings.hooks.SubagentStop?.[0]?.matcher).toBe(REVIEWER_AGENT_TYPE);
    expect(settings.hooks.PostToolUse.some((e) => e.matcher === 'Agent')).toBe(true);
    const agent = await readFile(join(dir, '.claude', 'agents', `${REVIEWER_AGENT_TYPE}.md`), 'utf8');
    expect(agent).not.toMatch(/^model:/m);
  });

  it('update retrofits a pre-push-only repo, which has no settings.json at all', async () => {
    const dir = await makeRepo();
    expect(runInit(dir, []).status).toBe(0);
    await rm(join(dir, '.claude', 'settings.json'), { force: true });
    await rm(join(dir, '.claude', 'agents'), { recursive: true, force: true });

    const r = spawnSync(process.execPath, [CLI, 'update', '--offline'], {
      cwd: dir,
      env: { ...process.env, HOME: dir, CLUD_BUG_QUIET: '1' },
      encoding: 'utf8',
      timeout: 60000,
    });
    expect(r.status).toBe(0);
    const settings = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf8'));
    expect(settings.hooks.SubagentStop[0].matcher).toBe(REVIEWER_AGENT_TYPE);
    // …and it must NOT have grown the commit-review surface it never asked for.
    expect(JSON.stringify(settings)).not.toContain('clud-bug-local-review');
  });
});

describe('#266 item 1 — init/update warn when the registration cannot be committed (SPEC §4.4:961)', () => {
  function runInit(dir, extraArgs) {
    return spawnSync(
      process.execPath,
      [CLI, 'init', '--offline', '--accept-all', '--no-set-protection', ...extraArgs],
      { cwd: dir, env: { ...process.env, HOME: dir, CLUD_BUG_QUIET: '1' }, encoding: 'utf8', timeout: 30000 },
    );
  }

  function buildBundleFor(dir, sha) {
    return spawnSync(
      process.execPath,
      [CLI, 'build-bundle', '--repo', 'o/r', '--pr', '7', '--sha', sha, '--recipe-version', 'test'],
      { cwd: dir, encoding: 'utf8', input: JSON.stringify({ critical_findings: [] }), timeout: 30000 },
    );
  }

  it('init warns and the bundle carries registration "uncommittable" when .claude/ is gitignored', async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, '.gitignore'), '.claude/\n');
    const r = runInit(dir, ['--with-hooks', '--hook-trigger', 'commit']);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('.claude/settings.json');
    expect(r.stderr).toContain('NOT committable');
    expect(r.stderr).toContain('SPEC §4.4');

    const sha = git(dir, ['rev-parse', 'HEAD']);
    const built = buildBundleFor(dir, sha);
    expect(built.status).toBe(0);
    expect(JSON.parse(built.stdout).attestation.registration).toBe('uncommittable');
  });

  it('init prints no warning, and the bundle carries registration "committable", in a normal repo', async () => {
    const dir = await makeRepo();
    const r = runInit(dir, ['--with-hooks', '--hook-trigger', 'commit']);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('NOT committable');

    const sha = git(dir, ['rev-parse', 'HEAD']);
    const built = buildBundleFor(dir, sha);
    expect(built.status).toBe(0);
    expect(JSON.parse(built.stdout).attestation.registration).toBe('committable');
  });

  it('runUpdate reports the registration gap as an advisory it cannot fix unattended', async () => {
    // `update` runs unattended in the self-update Action as often as by hand
    // (see the `#319` comment on `RunUpdateResult.advisories`), so this is
    // asserted directly on `advisories` — the channel `update.ts` owns for
    // exactly this kind of repo-config state — rather than through the CLI's
    // print path (`main.ts`'s update command, which is not this lane's file).
    const dir = await makeRepo();
    expect(runInit(dir, ['--with-hooks', '--hook-trigger', 'commit']).status).toBe(0);
    await writeFile(join(dir, '.gitignore'), '.claude/\n');

    const result = await runUpdate({
      cwd: dir, templatesDir: TEMPLATES, baselineDir: BASELINE, ourVersion: '0.0.0-test',
      loadBaselineOpts: offlineLoadBaseline,
    });
    expect(
      (result.advisories ?? []).some((a) => a.includes('NOT committable') && a.includes('SPEC §4.4')),
    ).toBe(true);
  });
});

describe('#266 hook entry builders', () => {
  it('the dispatch entry matches the Agent tool, the completion entry the reviewer type', () => {
    expect(buildAttestDispatchHook().matcher).toBe('Agent');
    expect(buildAttestCompletionHook().matcher).toBe(REVIEWER_AGENT_TYPE);
  });
});
