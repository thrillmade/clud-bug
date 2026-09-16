// clud-bug#332 FOR REAL — the Action's --allowedTools whitelist granted the
// model BOTH a budgeted way to read a skill file (`Bash(head:*)`, the
// recipe the system prompt instructs: `head -c "$MAX_SKILL_BYTES"
// .claude/skills/<name>/SKILL.md`, src/core/prompts.ts) AND an unbudgeted
// one (`Bash(cat .claude/skills/*/SKILL.md)`) matching the exact same glob.
// SPEC 2.0 §2.1: "A skill body SHOULD stay under 8 KiB — past that an agent
// is paying to read prose it will not act on." MAX_SKILL_BYTES
// (DEFAULT_MAX_SKILL_BYTES = 8192, src/core/prompt-builder.ts) was enforced
// nowhere in code — only ever prompt text plus an allowed shell pattern the
// model didn't have to pick.
//
// A prior pass here dropped the `cat` grant and called it done, but left
// `Bash(head:*)` in place with a comment admitting it "remains a wildcard".
// That doesn't close the issue: `Bash(head:*)` is a wildcard on the WHOLE
// command line, so `head -c 999999999 .claude/skills/x/SKILL.md` is exactly
// as permitted as the documented `head -c "$MAX_SKILL_BYTES"` one — the cap
// was still only ever prompt text.
//
// Fixed for real: the ONE grant that can read a skill body names its cap in
// the command itself — `Bash(head -c 8192 .claude/skills/*/SKILL.md)` (8192
// = DEFAULT_MAX_SKILL_BYTES, literal rather than `{{MAX_SKILL_BYTES}}`
// because scripts/run-benchmark.mjs extracts --allowedTools from the RAW,
// un-rendered template — a `{{...}}` token there would ship inert into that
// runner's real invocation). No `head:*`, no `cat` of a skill body, and no
// `git show:*` either — that grant was "added defensively" for base-ref
// reads that, in fact, all happen in workflow-level `run:` steps (outside
// this allowlist entirely); left in place it could `git show
// <any-ref>:.claude/skills/<name>/SKILL.md` for the full, uncapped body.
// `Bash(cat .claude/skills/.clud-bug.json)` stays — a small, fixed
// manifest, not the unbounded skill body §2.1 is about. The diff/comment
// budget recipes keep their own `head -c <N>` grants (4 literal byte
// counts, no path argument at all, so none of them can resolve any file
// path, let alone one under `.claude/skills`).

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { reviewPrompt } from '../src/core/prompts.js';
import { renderFile, templateLanguage } from '../src/core/render.js';
import { DEFAULT_MAX_SKILL_BYTES } from '../src/core/prompt-builder.js';

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATES = join(PKG_ROOT, 'templates');
const WORKFLOW_TEMPLATES = ['workflow.yml.tmpl', 'workflow-ts.yml.tmpl', 'workflow-py.yml.tmpl'];
const SKILL_READ_GRANT = `Bash(head -c ${DEFAULT_MAX_SKILL_BYTES} .claude/skills/*/SKILL.md)`;

async function render(tmpl) {
  return renderFile(join(TEMPLATES, tmpl), {
    REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: templateLanguage(tmpl) }),
  });
}

/** Extract the `--allowedTools "..."` value from the rendered claude_args block. */
async function allowedTools(tmpl) {
  const doc = parseYaml(await render(tmpl));
  const step = doc.jobs.review.steps.find(
    (s) => s && typeof s.uses === 'string' && s.uses.includes('claude-code-action'),
  );
  assert.ok(step, `${tmpl}: no claude-code-action step`);
  const match = String(step.with.claude_args).match(/--allowedTools "([^"]*)"/);
  assert.ok(match, `${tmpl}: claude_args has no --allowedTools entry`);
  return match[1];
}

test('#332: --allowedTools does not grant an uncapped `cat` of a SKILL.md body', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const tools = await allowedTools(tmpl);
    assert.doesNotMatch(
      tools,
      /Bash\(cat \.claude\/skills\/\*\/SKILL\.md\)/,
      `${tmpl}: --allowedTools still grants an uncapped 'cat' of a skill body, defeating MAX_SKILL_BYTES`,
    );
  }
});

test('#332 CONTROL: the uncapped-cat pattern above actually matches the pre-fix grant', () => {
  // Control for the negative assertion: prove the regex fires on the
  // exact pre-fix string, so a silently-broken pattern can't report a
  // false "no uncapped grant" clean bill.
  const preFix =
    'mcp__github_inline_comment__create_inline_comment,Bash(cat .claude/skills/.clud-bug.json),Bash(cat .claude/skills/*/SKILL.md),Bash(head:*)';
  assert.match(preFix, /Bash\(cat \.claude\/skills\/\*\/SKILL\.md\)/);
});

test('#332 FOR REAL: --allowedTools no longer grants the uncapped `Bash(head:*)` wildcard', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const tools = await allowedTools(tmpl);
    assert.doesNotMatch(
      tools,
      /Bash\(head:\*\)/,
      `${tmpl}: --allowedTools still grants Bash(head:*) — a wildcard on the whole command line never actually capped a skill read`,
    );
  }
});

test('#332 FOR REAL CONTROL: the head:* pattern above actually matches the pre-fix grant', () => {
  const preFix = 'Bash(cat .claude/skills/.clud-bug.json),Bash(head:*)';
  assert.match(preFix, /Bash\(head:\*\)/);
});

test('#332 FOR REAL: --allowedTools grants exactly ONE read reaching .claude/skills body content, and it carries the rendered cap', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const tools = await allowedTools(tmpl);
    const entries = tools.split(',').map((t) => t.trim());
    // "Reaching .claude/skills" here means a grant whose command could
    // print SKILL.md body content — not the small, fixed manifest read
    // (`cat .claude/skills/.clud-bug.json`), which SPEC 2.1 explicitly
    // does not scope this cap to.
    const skillBodyReads = entries.filter(
      (e) => e.includes('.claude/skills') && !e.includes('.clud-bug.json'),
    );
    assert.deepEqual(
      skillBodyReads,
      [SKILL_READ_GRANT],
      `${tmpl}: expected exactly one grant reaching a skill body (${SKILL_READ_GRANT}), found: ${JSON.stringify(skillBodyReads)}`,
    );
    // The cap in that one grant must be the RENDERED DEFAULT_MAX_SKILL_BYTES,
    // not a stale or independently-typed number.
    assert.match(
      skillBodyReads[0],
      new RegExp(`^Bash\\(head -c ${DEFAULT_MAX_SKILL_BYTES} \\.claude/skills/\\*/SKILL\\.md\\)$`),
      `${tmpl}: the one skill-body grant does not carry DEFAULT_MAX_SKILL_BYTES (${DEFAULT_MAX_SKILL_BYTES})`,
    );
  }
});

test('#332 FOR REAL CONTROL: the "exactly one .claude/skills grant" check actually catches a second one', () => {
  // Control for the assertion above: prove that adding a second grant
  // reaching a skill body (e.g. a reintroduced `cat` alongside the capped
  // `head`) is NOT silently accepted as still "exactly one".
  const withTwoGrants = [
    'Bash(cat .claude/skills/.clud-bug.json)',
    SKILL_READ_GRANT,
    'Bash(cat .claude/skills/*/SKILL.md)',
  ];
  const skillBodyReads = withTwoGrants.filter(
    (e) => e.includes('.claude/skills') && !e.includes('.clud-bug.json'),
  );
  assert.equal(skillBodyReads.length, 2, 'control: harness did not detect the reintroduced second grant');
});

test('#332 FOR REAL: --allowedTools no longer grants Bash(git show:*) — dead weight that could also reach a skill body uncapped', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const tools = await allowedTools(tmpl);
    assert.doesNotMatch(
      tools,
      /Bash\(git show:\*\)/,
      `${tmpl}: --allowedTools still grants Bash(git show:*) — git show <any-ref>:.claude/skills/<name>/SKILL.md prints a skill body in full, no byte cap possible`,
    );
  }
});

test('#332 FOR REAL: the diff/comment budget recipes keep working — 4 literal, path-less head -c grants', async () => {
  // MAX_DIFF_BYTES=5000000 / MAX_COMMENT_BYTES=20000 (test/prompts.test.js
  // pins these across all 3 templates) and their tee-hint doublings
  // (10000000 / 40000) are the ONLY byte counts the system prompt actually
  // teaches for the piped (no file argument) head recipes. None of these
  // four grants carry a path segment, so none of them can resolve any
  // file — a hostile `head -c 5000000 .claude/skills/x/SKILL.md` (extra
  // trailing argument) does not match an exact 3-token grant.
  const expected = ['Bash(head -c 5000000)', 'Bash(head -c 10000000)', 'Bash(head -c 20000)', 'Bash(head -c 40000)'];
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const tools = await allowedTools(tmpl);
    for (const grant of expected) {
      assert.ok(
        tools.split(',').map((t) => t.trim()).includes(grant),
        `${tmpl}: missing diff/comment budget grant '${grant}'`,
      );
    }
  }
});

test('#332: the system prompt documents `head -c` as the capped skill-read recipe (documentation, not enforcement)', () => {
  // The prompt this repo does not own for this ticket (src/core/prompts.ts,
  // unedited by this fix) tells the model to cap with `head -c
  // "$MAX_SKILL_BYTES"` and never mentions `cat` for a skill BODY. The
  // --allowedTools grants above narrow what the allowlist DOCUMENTS as the
  // intended recipe — they do not bind MAX_SKILL_BYTES: `head` and `cat`
  // are Claude Code built-in read-only commands with no permission check
  // at all, and this same allowlist keeps `Bash(git diff:*)` /
  // `Bash(gh api repos/:*)` for legitimate diff-fetching, both of which
  // can reach a skill body's full bytes uncapped by a different route.
  // What actually binds the cap is the prompt builder's own truncation of
  // what the model is GIVEN (src/core/prompt-builder.ts, the App's
  // buildReviewPrompt path) — not an allow-list over what a model with a
  // shell is permitted to run.
  const out = reviewPrompt({ projectDescription: 'p' });
  assert.match(
    out,
    /head -c "\$MAX_SKILL_BYTES" \.claude\/skills\/<name>\/SKILL\.md/,
    'system prompt no longer documents the capped head -c recipe for reading a skill body',
  );
});
