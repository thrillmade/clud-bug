import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewPrompt } from '../src/core/prompts.js';
import { renderFile, templateLanguage } from '../lib/render.js';

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATES = join(PKG_ROOT, 'templates');

// --- 0.A.1: lib/prompts.js extraction (was inline in templates) ---
// reviewPrompt() is the source of truth for the clud-bug review prompt
// across all three templates. Tests verify:
// (a) the function returns the same prompt structure for all languages
// (b) language-specific bullets render in the right place
// (c) the rendered template's prompt body matches reviewPrompt() output
// (d) v0.6.2+ downstream PRs (caching, budgets, comment format) can
//     change one function without divergence across templates.

test('reviewPrompt requires projectDescription', () => {
  assert.throws(() => reviewPrompt({}), /projectDescription is required/);
});

test('reviewPrompt rejects unknown language', () => {
  assert.throws(
    () => reviewPrompt({ projectDescription: 'p', language: 'ruby' }),
    /unknown language 'ruby'/,
  );
});

test('reviewPrompt embeds the project description at the top', () => {
  const out = reviewPrompt({ projectDescription: 'XYZ-DESCRIPTION' });
  assert.match(out, /^XYZ-DESCRIPTION\n/);
});

test('reviewPrompt for generic language uses just the test-coverage bullet', () => {
  const out = reviewPrompt({ projectDescription: 'p', language: 'generic' });
  assert.match(out, /- Broken or missing test coverage for new code/);
  assert.doesNotMatch(out, /TypeScript type safety/);
  assert.doesNotMatch(out, /Incorrect exception handling/);
});

test('reviewPrompt for ts adds 4 TypeScript-specific bullets', () => {
  const out = reviewPrompt({ projectDescription: 'p', language: 'ts' });
  assert.match(out, /- Broken or missing test coverage for new code/);
  assert.match(out, /- TypeScript type safety issues/);
  assert.match(out, /- Incorrect ESM\/CJS module usage/);
  assert.match(out, /- Improper async\/await or Promise handling/);
  assert.match(out, /- Incorrect use of common Node\.js patterns/);
});

test('reviewPrompt for py replaces test-coverage with 4 Python-specific bullets', () => {
  const out = reviewPrompt({ projectDescription: 'p', language: 'py' });
  // Python variant REPLACES the generic test-coverage line (per the
  // original templates' diff). It uses pytest-specific phrasing instead.
  assert.doesNotMatch(out, /- Broken or missing test coverage for new code/);
  assert.match(out, /- Incorrect exception handling/);
  assert.match(out, /- Missing type hints on new functions/);
  assert.match(out, /- Incorrect use of Click/);
  assert.match(out, /- Missing pytest coverage for new code/);
});

test('reviewPrompt includes the core review-discipline sections', () => {
  // Spot-check that the structural anchors from the original prompt
  // survived extraction. These markers gate clud-bug's downstream
  // parsing (lib/skills.js classifyPerSkillOutcome, strict-mode header
  // regex). Snapshot-light: prevent silent regressions during future
  // edits to reviewPrompt() without locking byte-for-byte.
  const out = reviewPrompt({ projectDescription: 'p' });
  const markers = [
    'Review this pull request for critical issues only',
    'Skill routing — shared vs dedicated',
    'Strict-mode header (opt-in)',
    '## 🐛 Clud Bug review',
    '**This round:**',
    '### Per-skill scan',
    'FIX-PUSH FLOW',
    'mcp__github_inline_comment__create_inline_comment',
  ];
  for (const marker of markers) {
    assert.match(out, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing marker: ${marker}`);
  }
});

// --- 0.A.3: per-section budgets (v0.6.4) ---
// The prompt instructs Claude to cap per-PR fetches with `head -c
// $MAX_DIFF_BYTES` etc. Combined with the env vars + Bash(head:*)
// allowedTool in the workflow templates, this caps the variable
// (non-cached) suffix of each review.

test('reviewPrompt includes per-section budget instructions', () => {
  const out = reviewPrompt({ projectDescription: 'p' });
  // Budget header section is present (post-0.0.P trim: "Section budgets (v0.6.4+)").
  assert.match(out, /Section budgets \(v0\.6\.4\+\)/);
  // Each of the three budget env vars is referenced.
  assert.match(out, /MAX_DIFF_BYTES/);
  assert.match(out, /MAX_COMMENT_BYTES/);
  assert.match(out, /MAX_SKILL_BYTES/);
  // The PR diff capping pattern is in the prompt.
  assert.match(out, /gh pr diff "\$PR_NUMBER" \| head -c "\$MAX_DIFF_BYTES"/);
});

test('rendered workflow.yml.tmpl sets the three budget env vars', async () => {
  const out = await renderFile(join(TEMPLATES, 'workflow.yml.tmpl'), {
    REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: 'generic' }),
  });
  assert.match(out, /MAX_DIFF_BYTES: '5000000'/);
  assert.match(out, /MAX_COMMENT_BYTES: '20000'/);
  assert.match(out, /MAX_SKILL_BYTES: '4000'/);
  // REPO_OWNER and REPO_NAME are needed by the comment-fetch pattern.
  assert.match(out, /REPO_OWNER: \$\{\{ github\.repository_owner \}\}/);
  assert.match(out, /REPO_NAME: \$\{\{ github\.event\.repository\.name \}\}/);
  // Bash(head:*) added to allowedTools so Claude can pipe through head.
  assert.match(out, /Bash\(head:\*\)/);
});

// --- 0.A.4 (v0.6.5): stats header + severity-prefix comment format ---
// Write-time compression: future re-reviews ingest prior clud-bug comments;
// compact format = cheaper ingest. The prompt instructs Claude to lead with
// "Found: N 🔴 / N 🟡 / N 🟣" and to use severity-emoji-prefix + collapsible
// <details> reasoning for each finding.

test('reviewPrompt instructs Claude to emit "Found: N 🔴 / N 🟡 / N 🟣" stats header', () => {
  const out = reviewPrompt({ projectDescription: 'p' });
  assert.match(out, /Found: N 🔴 \/ N 🟡 \/ N 🟣/u);
  // The three severity tiers must be named: important, nit, pre-existing.
  assert.match(out, /🔴 important/u);
  assert.match(out, /🟡 nit/u);
  assert.match(out, /🟣 pre-existing/u);
});

test('reviewPrompt instructs Claude to use severity-prefix + <details> per finding', () => {
  const out = reviewPrompt({ projectDescription: 'p' });
  // Per-finding format prompt language.
  assert.match(out, /🔴 \[skill-name\]: One-line claim/u);
  assert.match(out, /<details><summary>Reasoning<\/summary>/);
});

test('rendered workflow-ts and workflow-py templates also set budget env vars', async () => {
  for (const tmpl of ['workflow-ts.yml.tmpl', 'workflow-py.yml.tmpl']) {
    const out = await renderFile(join(TEMPLATES, tmpl), {
      REVIEW_PROMPT: reviewPrompt({
        projectDescription: 'p',
        language: tmpl.includes('-ts') ? 'ts' : 'py',
      }),
    });
    assert.match(out, /MAX_DIFF_BYTES: '5000000'/, `${tmpl} missing MAX_DIFF_BYTES`);
    assert.match(out, /Bash\(head:\*\)/, `${tmpl} missing Bash(head:*) in allowedTools`);
  }
});

// --- 0.A.7 (v0.6.8): --max-turns + MAX_THINKING_TOKENS cost-control knobs ---
// Anthropic-recommended knobs from code.claude.com/docs/en/costs applied to
// all 3 workflow templates. --max-turns caps the agentic loop (runaway
// protection); MAX_THINKING_TOKENS caps the extended-thinking budget per turn.

test('all 3 rendered workflow templates set MAX_THINKING_TOKENS=8000', async () => {
  for (const tmpl of ['workflow.yml.tmpl', 'workflow-ts.yml.tmpl', 'workflow-py.yml.tmpl']) {
    const lang = tmpl.includes('-ts') ? 'ts' : tmpl.includes('-py') ? 'py' : 'generic';
    const out = await renderFile(join(TEMPLATES, tmpl), {
      REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: lang }),
    });
    assert.match(
      out,
      /MAX_THINKING_TOKENS: '8000'/,
      `${tmpl} missing MAX_THINKING_TOKENS=8000 (v0.6.8)`,
    );
  }
});

test('all 3 rendered workflow templates pass smart-budget --max-turns via claude_args (v0.6.25 / §5.5 Layer 1)', async () => {
  for (const tmpl of ['workflow.yml.tmpl', 'workflow-ts.yml.tmpl', 'workflow-py.yml.tmpl']) {
    const lang = tmpl.includes('-ts') ? 'ts' : tmpl.includes('-py') ? 'py' : 'generic';
    const out = await renderFile(join(TEMPLATES, tmpl), {
      REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: lang }),
    });
    // v0.6.25 / §5.5 Layer 1: --max-turns is dynamic, sourced from
    // paths-check's max_turns output (computed via line-based formula,
    // not the v0.6.23 4-bucket if-elif).
    assert.match(
      out,
      /--max-turns \$\{\{\s*needs\.paths-check\.outputs\.max_turns\s*\}\}/,
      `${tmpl}: claude_args must source --max-turns from paths-check.outputs.max_turns`,
    );
    // paths-check job emits the max_turns output.
    assert.match(
      out,
      /max_turns:\s*\$\{\{\s*steps\.classify\.outputs\.max_turns\s*\}\}/,
      `${tmpl}: paths-check must declare max_turns output`,
    );
    // v0.6.25 Layer 1: paths-check has the smart-budget formula
    // (jq estimator + 20% safety margin + 60-turn ceiling).
    assert.match(
      out,
      /TURNS_ESTIMATED=\$\(echo "\$FILES_JSON" \| jq/,
      `${tmpl}: paths-check must include the smart-budget jq estimator (v0.6.25 / §5.5 Layer 1)`,
    );
    assert.match(
      out,
      /def per_line\(path\):/,
      `${tmpl}: smart-budget formula must define per_line(path) for type-weighting`,
    );
    assert.match(
      out,
      /MAX_TURNS=\$\(\(\s*\(?TURNS_ESTIMATED\s*\*\s*12\s*\+\s*9\s*\)?\s*\/\s*10\s*\)\)/,
      `${tmpl}: paths-check must apply the 20% safety margin (max_turns = ceil(estimated × 1.2))`,
    );
    assert.match(
      out,
      /MAX_TURNS=60/,
      `${tmpl}: paths-check must enforce the 60-turn ceiling (Layer 5 retry above this in v0.6.26+)`,
    );
    // v0.6.25 Layer 1.5: paths-check emits the calibration outputs.
    for (const outName of ['turns_estimated', 'files_count', 'lines_added', 'lines_deleted', 'threads_count']) {
      assert.match(
        out,
        new RegExp(`${outName}:\\s*\\$\\{\\{\\s*steps\\.classify\\.outputs\\.${outName}\\s*\\}\\}`),
        `${tmpl}: paths-check must declare ${outName} output (v0.6.25 / §5.5 Layer 1.5 calibration)`,
      );
    }
    // v0.6.25 Layer 2: per-PR prompt block carries the live budget values.
    assert.match(
      out,
      /max_turns=\$\{\{\s*needs\.paths-check\.outputs\.max_turns\s*\}\}/,
      `${tmpl}: per-PR prompt must inject max_turns into the Layer 2 budget block`,
    );
    // v0.6.25: workflow-level concurrency group.
    assert.match(
      out,
      /concurrency:\s*\n\s+group:\s*clud-bug-review/,
      `${tmpl}: workflow-level concurrency group must cancel older in-flight runs (v0.6.25)`,
    );
    // v0.6.24 backout — `actions: read` was added in v0.6.23 for
    // github_ci MCP server but broke `pull_request` trigger firing
    // on private consumer repos (validated: tokenomics + rezgen
    // stopped firing after v0.6.23 propagation; agent-skills + logmind
    // continued firing). Until the private-repo trigger-registration
    // semantics are understood, the templates MUST NOT request
    // `actions: read` anywhere — but the explanatory comment block
    // mentioning the backout is fine. Match only the unindented YAML
    // mapping form (i.e. an actual permission grant, not a comment).
    assert.doesNotMatch(
      out,
      /^[ \t]+actions: read[ \t]*$/m,
      `${tmpl}: v0.6.24 backout — templates must not request 'actions: read' as a YAML mapping (broke pull_request triggers on private repos under v0.6.23). Comment text mentioning the backout is OK.`,
    );
    // REGRESSION GUARD (PR #116 clud-bug-review catch): the empty-CHANGED
    // early-exit path (gh pr diff auth/network failure OR theoretical
    // no-files PR) must ALSO emit max_turns. Otherwise --max-turns expands
    // to empty in clud-bug-review and fails the CLI invocation. Pre-v0.6.23
    // this was harmless (hard-coded `15`); this PR introduced the risk.
    // v0.6.24 SC2129 fix: the 3 echoes are now grouped under a single
    // { ... } >> "$GITHUB_OUTPUT" block. Regex updated to match both
    // the old per-line form AND the new grouped form.
    assert.match(
      out,
      /if \[ -z "\$CHANGED" \];[\s\S]+?echo "max_turns=15"[\s\S]+?exit 0/,
      `${tmpl}: empty-CHANGED early-exit must emit max_turns=15 before exit 0`,
    );
  }
});

test('all 3 rendered workflow templates pin strict-mode-gate at the current package.json version', async () => {
  // Reads package.json so the test never drifts past a version bump
  // (release-discipline.test.js also asserts the same lock-step).
  const pkg = JSON.parse(
    await (await import('node:fs/promises')).readFile(
      join(TEMPLATES, '..', 'package.json'),
      'utf8',
    ),
  );
  const expected = new RegExp(`strict-mode-gate@v${pkg.version.replace(/\./g, '\\.')}`);
  for (const tmpl of ['workflow.yml.tmpl', 'workflow-ts.yml.tmpl', 'workflow-py.yml.tmpl']) {
    const lang = tmpl.includes('-ts') ? 'ts' : tmpl.includes('-py') ? 'py' : 'generic';
    const out = await renderFile(join(TEMPLATES, tmpl), {
      REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: lang }),
    });
    assert.match(
      out,
      expected,
      `${tmpl} composite-pin out of sync with package.json (${pkg.version})`,
    );
  }
});

// --- 0.A.10 (v0.6.10): incremental-diff review on fix-push ---
// Prompt teaches Claude to read the `<!-- last-reviewed-sha: <sha> -->`
// marker in prior summary comments, verify ancestry via `git merge-base
// --is-ancestor`, and branch between `git diff <sha>..HEAD` (delta) and
// `gh pr diff` (full). The prompt also instructs Claude to emit the
// marker on every new summary comment so the handshake compounds.

test('reviewPrompt teaches Claude the incremental-diff handshake (read marker, check ancestor, branch)', () => {
  const out = reviewPrompt({ projectDescription: 'p' });
  // Marker shape Claude must parse (with the escaped HTML-comment syntax).
  assert.match(
    out,
    /last-reviewed-sha: <sha>/,
    'prompt must describe the `last-reviewed-sha: <sha>` marker shape',
  );
  // Ancestor check is the rebase/force-push fallback gate.
  assert.match(
    out,
    /git merge-base --is-ancestor/,
    'prompt must describe the `git merge-base --is-ancestor` ancestry check',
  );
  // Delta fetch when marker + ancestor both hold.
  assert.match(
    out,
    /git diff <prior_sha>\.\.\$HEAD_SHA/,
    'prompt must describe the `git diff <prior_sha>..$HEAD_SHA` delta fetch',
  );
  // Fallback to gh pr diff named explicitly.
  assert.match(
    out,
    /gh pr diff "\$PR_NUMBER" \| head -c "\$MAX_DIFF_BYTES"/,
    'prompt must keep the full-diff fallback for first-review / non-ancestor cases',
  );
});

test('reviewPrompt teaches Claude to identify the PRIOR SUMMARY (not the in-progress comment)', () => {
  // Regression for the v0.6.10 bug PR #100 caught at lib/prompts.js:74-77:
  // anthropics/claude-code-action posts a `[claude]: Claude Code is
  // working…` progress comment BEFORE the SDK runs. The "LAST claude[bot]
  // body" wording landed on that comment, found no marker, and fell
  // through to full-diff on every fix-push — handshake never fired.
  // Fix: prompt must anchor selection to the `## 🐛 Clud Bug review`
  // header (same anchor the strict-mode gate uses), NOT to "latest by
  // claude[bot]".
  const out = reviewPrompt({ projectDescription: 'p' });
  // Header-anchored selection — the unambiguous source-of-truth identifier
  // for a prior summary comment.
  assert.match(
    out,
    /## 🐛 Clud Bug review/u,
    'prompt must anchor prior-summary detection to the H2 header line, not "last claude[bot] comment"',
  );
  // Explicit warning about the progress comment so future edits to this
  // section don't silently regress back to the buggy wording.
  assert.match(
    out,
    /Claude Code is working/,
    'prompt must explicitly warn Claude that the progress comment is NOT the prior summary',
  );
});

test('reviewPrompt: detection walks claude[bot] comments newest-first (not arbitrary order)', () => {
  // GitHub's REST /issues/:number/comments endpoint ignores
  // direction=desc per `lib/skills.js:512-514` notes, so the prompt
  // must pass the sort + direction params AND tell Claude to walk
  // newest-first explicitly — otherwise selection is non-deterministic
  // across multiple summary comments on the same PR.
  const out = reviewPrompt({ projectDescription: 'p' });
  assert.match(
    out,
    /sort=created&direction=desc/,
    'prompt must request newest-first ordering via gh api query params',
  );
  assert.match(
    out,
    /newest-first/,
    'prompt must explicitly tell Claude to walk newest-first when selecting the prior summary',
  );
});

test('reviewPrompt instructs Claude to emit the SHA marker on every summary comment', () => {
  const out = reviewPrompt({ projectDescription: 'p' });
  // Marker template (literal $HEAD_SHA shown in instructions; Claude
  // substitutes the actual value when posting).
  assert.match(
    out,
    /<!-- last-reviewed-sha: \$HEAD_SHA -->/,
    'prompt must instruct Claude to append the `<!-- last-reviewed-sha: $HEAD_SHA -->` marker',
  );
});

test('all 3 rendered workflow templates expose HEAD_SHA env var (v0.6.10+)', async () => {
  for (const tmpl of ['workflow.yml.tmpl', 'workflow-ts.yml.tmpl', 'workflow-py.yml.tmpl']) {
    const lang = tmpl.includes('-ts') ? 'ts' : tmpl.includes('-py') ? 'py' : 'generic';
    const out = await renderFile(join(TEMPLATES, tmpl), {
      REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: lang }),
    });
    assert.match(
      out,
      /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/,
      `${tmpl} missing HEAD_SHA env var (v0.6.10)`,
    );
  }
});

test('all 3 rendered workflow templates allow git diff + git merge-base (v0.6.10+)', async () => {
  for (const tmpl of ['workflow.yml.tmpl', 'workflow-ts.yml.tmpl', 'workflow-py.yml.tmpl']) {
    const lang = tmpl.includes('-ts') ? 'ts' : tmpl.includes('-py') ? 'py' : 'generic';
    const out = await renderFile(join(TEMPLATES, tmpl), {
      REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: lang }),
    });
    assert.match(
      out,
      /Bash\(git diff:\*\)/,
      `${tmpl} missing Bash(git diff:*) in allowedTools (v0.6.10)`,
    );
    assert.match(
      out,
      /Bash\(git merge-base:\*\)/,
      `${tmpl} missing Bash(git merge-base:*) in allowedTools (v0.6.10)`,
    );
  }
});

// --- 0.A.8 (v0.6.11): pin model to Sonnet 4.6 ---
// Phase 0.A.8 spike confirmed claude-code-action's default lands on Opus 4.7
// (~5x Sonnet's input cost). PR review fits Sonnet's profile per Anthropic
// docs. Pin the model explicitly so we don't drift back to Opus on a future
// claude-code-action default change.

// --- 0.0.W (v0.6.14): workflow-PR review skip ---
// When a PR only touches workflow files, the clud-bug-review job skips
// entirely (claude-code-action would refuse anyway due to self-modification
// guard; no useful review surface either). Eliminates the ~6 admin-bypass
// merges per propagation cycle.

test('all 3 rendered workflow templates declare a paths-check pre-flight job (v0.6.14+)', async () => {
  for (const tmpl of ['workflow.yml.tmpl', 'workflow-ts.yml.tmpl', 'workflow-py.yml.tmpl']) {
    const lang = tmpl.includes('-ts') ? 'ts' : tmpl.includes('-py') ? 'py' : 'generic';
    const out = await renderFile(join(TEMPLATES, tmpl), {
      REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: lang }),
    });
    assert.match(out, /^\s+paths-check:/m,
      `${tmpl} missing the paths-check job (v0.6.14 / 0.0.W)`);
    assert.match(out, /is_workflow_only:/,
      `${tmpl} missing the is_workflow_only output (v0.6.14)`);
  }
});

test('all 3 rendered workflow templates: clud-bug-review depends on paths-check + skips on workflow-only', async () => {
  for (const tmpl of ['workflow.yml.tmpl', 'workflow-ts.yml.tmpl', 'workflow-py.yml.tmpl']) {
    const lang = tmpl.includes('-ts') ? 'ts' : tmpl.includes('-py') ? 'py' : 'generic';
    const out = await renderFile(join(TEMPLATES, tmpl), {
      REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: lang }),
    });
    assert.match(out, /needs: paths-check/,
      `${tmpl} clud-bug-review must depend on paths-check`);
    assert.match(
      out,
      /if:\s*needs\.paths-check\.outputs\.is_workflow_only\s*!=\s*'true'/,
      `${tmpl} clud-bug-review must skip when paths-check reports workflow-only`,
    );
  }
});

test('paths-check classifier: 0.0.W² allow-list + workflow-change signal (v0.6.26+)', async () => {
  // The classifier shell uses `case "$f" in ...`. v0.6.14 (0.0.W) had two
  // patterns (workflow + strict-mode-gate); v0.6.26 (0.0.W²) widened the
  // allow-list to cover all files `clud-bug update` produces, AND added a
  // HAS_WORKFLOW_CHANGE signature so naked AGENTS.md edits still get
  // reviewed.
  const out = await renderFile(join(TEMPLATES, 'workflow.yml.tmpl'), {
    REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: 'generic' }),
  });

  // Original 0.0.W patterns — these set HAS_WORKFLOW_CHANGE=true.
  assert.match(out, /\.github\/workflows\/clud-bug-\*\.yml\)\s*HAS_WORKFLOW_CHANGE=true/,
    'workflow-file change must flip HAS_WORKFLOW_CHANGE');
  assert.match(out, /\.github\/actions\/strict-mode-gate\/\*\)\s*HAS_WORKFLOW_CHANGE=true/,
    'strict-mode-gate change must flip HAS_WORKFLOW_CHANGE');

  // v0.6.26 / 0.0.W² additions — these are silent allowlist entries
  // (don't trigger the workflow-change signal alone).
  for (const pattern of [
    /AGENTS\.md\)/,
    /\.cursorrules\|\.clinerules\|\.windsurfrules\|\.continuerules\)/,
    /\.github\/copilot-instructions\.md\)/,
    /\.claude\/skills\/\.clud-bug\.json\)/,
    /\.claude\/skills\/critical-issues-only\/SKILL\.md\)/,
    /\.claude\/skills\/evidence-based-review\/SKILL\.md\)/,
    /\.claude\/skills\/respect-existing-conventions\/SKILL\.md\)/,
    /docs\/timeline\.md\|docs\/file-structure\.md\|docs\/decisions\.md\)/,
    /docs\/decisions-branches\/\*\.md\)/,
  ]) {
    assert.match(out, pattern, `0.0.W² allowlist must include pattern matching ${pattern}`);
  }

  // Critical: the `*) ALL_IN_ALLOWLIST=false; break ;;` default branch
  // ensures any unmatched file flips the classifier — a mixed PR cannot
  // sneak through.
  assert.match(out, /\*\)\s*ALL_IN_ALLOWLIST=false/,
    'mixed-diff guard MUST be present — any non-allow-list file flips the classifier to false');

  // 0.0.W² safety: both conditions required to skip review. Naked
  // AGENTS.md edits (allowlist match but no workflow change) MUST run
  // review — this is the prompt-injection-via-AGENTS.md guard.
  assert.match(out,
    /ALL_IN_ALLOWLIST.*=.*"true".*\&\&.*HAS_WORKFLOW_CHANGE.*=.*"true"/s,
    '0.0.W² must require BOTH all-in-allowlist AND has-workflow-change to skip review');
});

// v0.6.26 / §5.5 Layer 6 — fallback render-from-inlines. PR #120 review
// caught the un-tested code path. The L6 step scrapes inline findings via
// gh api, counts them by emoji prefix, and synthesizes a structured
// summary. These tests pin the load-bearing pieces of that flow.
test('Layer 6 fallback: scrapes inline findings via gh api with claude[bot] + commit_id filter', async () => {
  for (const tmpl of ['workflow.yml.tmpl', 'workflow-py.yml.tmpl', 'workflow-ts.yml.tmpl']) {
    const lang = tmpl.includes('-ts') ? 'ts' : tmpl.includes('-py') ? 'py' : 'generic';
    const out = await renderFile(join(TEMPLATES, tmpl), {
      REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: lang }),
    });
    // Must hit the pulls/N/comments endpoint (inline findings live there;
    // issues/N/comments is the summary thread — would miss everything).
    assert.match(out, /pulls\/\$PR_NUMBER\/comments/,
      `${tmpl}: L6 must scrape pulls/PR/comments (inline endpoint)`);
    // Must filter by claude[bot] author (the inline-finding poster) AND
    // the current HEAD_SHA (so prior-pass findings don't double-count).
    assert.match(out, /select\(\.user\.login\s*==\s*\\?"claude\[bot\]\\?"\s*and\s*\.commit_id\s*==\s*\\?"\$HEAD_SHA\\?"\)/,
      `${tmpl}: L6 must filter inline findings to claude[bot] + current HEAD_SHA`);
  }
});

test('Layer 6 fallback: counts findings by emoji prefix (🔴 / 🟡 / 🟣)', async () => {
  for (const tmpl of ['workflow.yml.tmpl', 'workflow-py.yml.tmpl', 'workflow-ts.yml.tmpl']) {
    const lang = tmpl.includes('-ts') ? 'ts' : tmpl.includes('-py') ? 'py' : 'generic';
    const out = await renderFile(join(TEMPLATES, tmpl), {
      REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: lang }),
    });
    assert.match(out, /CRITICAL=.*test\(\\?"🔴\\?"\)/,
      `${tmpl}: L6 must count 🔴 critical findings`);
    assert.match(out, /MINOR=.*test\(\\?"🟡\\?"\)/,
      `${tmpl}: L6 must count 🟡 minor findings`);
    assert.match(out, /PREEXISTING=.*test\(\\?"🟣\\?"\)/,
      `${tmpl}: L6 must count 🟣 preexisting findings`);
  }
});

test('Layer 6 fallback: synthetic summary uses correct counters (PR #120 review fix)', async () => {
  // The "still open" counter is for prior unresolved threads — NEW
  // findings from the current pass aren't "still open" in that sense.
  // PR #120 review caught the original L6 misusing INLINE_COUNT as the
  // still-open value. Pin the correct semantic: still-open is 0 in the
  // L6 synthetic, because L6 only fires on the first pass (structured
  // output empty means we never reached the resolve-prior-threads stage).
  for (const tmpl of ['workflow.yml.tmpl', 'workflow-py.yml.tmpl', 'workflow-ts.yml.tmpl']) {
    const lang = tmpl.includes('-ts') ? 'ts' : tmpl.includes('-py') ? 'py' : 'generic';
    const out = await renderFile(join(TEMPLATES, tmpl), {
      REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: lang }),
    });
    // The L6 "This round" line uses the per-emoji counters for critical
    // + minor, and 0 for both "resolved from prior" and "still open".
    assert.match(out, /\$CRITICAL critical · \$MINOR minor · 0 resolved from prior · 0 still open/,
      `${tmpl}: L6 synthetic "This round" line must use correct counters (PR #120 fix)`);
    // Regression guard: never use INLINE_COUNT as the still-open value.
    assert.doesNotMatch(out, /\$INLINE_COUNT still open/,
      `${tmpl}: L6 must NOT use INLINE_COUNT for the still-open field (per-spec misuse caught in PR #120 review)`);
  }
});

test('Layer 6 fallback: synthetic summary cites "Synthetic summary" + version marker so readers know', async () => {
  for (const tmpl of ['workflow.yml.tmpl', 'workflow-py.yml.tmpl', 'workflow-ts.yml.tmpl']) {
    const lang = tmpl.includes('-ts') ? 'ts' : tmpl.includes('-py') ? 'py' : 'generic';
    const out = await renderFile(join(TEMPLATES, tmpl), {
      REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: lang }),
    });
    assert.match(out, /\*\*Synthetic summary\*\*/,
      `${tmpl}: L6 must label its synthetic summary so readers know it's reconstructed`);
    assert.match(out, /v0\.6\.26.*Layer 6 fallback/,
      `${tmpl}: L6 must cite the v0.6.26 §5.5 Layer 6 marker for traceability`);
  }
});

test('Layer 6 fallback: critical-findings status_header when CRITICAL > 0', async () => {
  // Strict-mode gate greps the H2 line for "critical findings". L6 must
  // suffix the H2 with " — critical findings" when CRITICAL > 0 so the
  // gate fires correctly. Without this, a synthetic summary covering
  // real critical inline findings would fall open advisory and skip the
  // gate — a silent quality regression.
  for (const tmpl of ['workflow.yml.tmpl', 'workflow-py.yml.tmpl', 'workflow-ts.yml.tmpl']) {
    const lang = tmpl.includes('-ts') ? 'ts' : tmpl.includes('-py') ? 'py' : 'generic';
    const out = await renderFile(join(TEMPLATES, tmpl), {
      REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: lang }),
    });
    assert.match(out, /\[ "\$CRITICAL" -gt 0 \] && STATUS=" — critical findings"/,
      `${tmpl}: L6 must set "— critical findings" suffix when CRITICAL > 0 so strict-mode gate fires`);
  }
});

test('Layer 6 fallback: legacy bare-H2 path when no inline findings either', async () => {
  // L6 falls through to the legacy bare-H2 advisory when INLINE_COUNT
  // is 0 — the action errored before posting anything substantive, so
  // there's nothing to synthesize. This preserves v0.6.22's behaviour
  // for the "action exploded with no output" failure mode.
  for (const tmpl of ['workflow.yml.tmpl', 'workflow-py.yml.tmpl', 'workflow-ts.yml.tmpl']) {
    const lang = tmpl.includes('-ts') ? 'ts' : tmpl.includes('-py') ? 'py' : 'generic';
    const out = await renderFile(join(TEMPLATES, tmpl), {
      REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: lang }),
    });
    assert.match(out, /if \[ "\$INLINE_COUNT" -gt 0 \]/,
      `${tmpl}: L6 must branch on INLINE_COUNT > 0`);
    // Both branches must emit a comment (no silent exit).
    const gateMatches = out.match(/gh pr comment "\$PR_NUMBER" --body/g) || [];
    assert.ok(gateMatches.length >= 3,
      `${tmpl}: L6 must emit a comment in both branches (synthetic + bare-H2) AND the structured-render step has its own — found ${gateMatches.length}`);
  }
});

test('all 3 rendered workflow templates use --model ${{ needs.paths-check.outputs.model }} (v0.6.15+)', async () => {
  // v0.6.11 hard-coded --model claude-sonnet-4-6. v0.6.15 (0.0.R)
  // makes the model dynamic: paths-check emits `model` output, which
  // claude_args interpolates. Trivial PRs route to Haiku; default
  // remains Sonnet (set in the classifier).
  for (const tmpl of ['workflow.yml.tmpl', 'workflow-ts.yml.tmpl', 'workflow-py.yml.tmpl']) {
    const lang = tmpl.includes('-ts') ? 'ts' : tmpl.includes('-py') ? 'py' : 'generic';
    const out = await renderFile(join(TEMPLATES, tmpl), {
      REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: lang }),
    });
    assert.match(
      out,
      /--model \$\{\{ needs\.paths-check\.outputs\.model \}\}/,
      `${tmpl} must use dynamic --model from paths-check (v0.6.15 / 0.0.R)`,
    );
    // The hard-coded Sonnet pin from v0.6.11 should no longer appear
    // as a literal `--model claude-sonnet-4-6` in claude_args.
    assert.doesNotMatch(
      out,
      /--model claude-sonnet-4-6\b/,
      `${tmpl} should not hard-code --model claude-sonnet-4-6; use the paths-check output instead`,
    );
  }
});

// --- 0.0.X (v0.6.16): output-token brevity directive ---
// The Claude Code CLI doesn't expose max_tokens (the SDK is agent-shaped,
// not single-call). Workaround: an explicit brevity instruction in the
// cached system prompt appendix. The directive lives in lib/prompts.js
// (the canonical source for the appendix) so caching covers it.

test('reviewPrompt: includes output-token brevity directive (v0.6.16 / 0.0.X)', () => {
  const out = reviewPrompt({ projectDescription: 'p' });
  // Core directive: ~600 token cap.
  assert.match(out, /Keep total output under ~600 tokens/);
  // Per-finding caps that drive the budget.
  assert.match(out, /Reasoning.*≤ 80 words/);
  assert.match(out, /No code quotes > 2 lines/);
});

// --- 0.0.R (v0.6.15): model routing for trivial PRs ---

test('paths-check exposes model output AND defaults to Sonnet', async () => {
  for (const tmpl of ['workflow.yml.tmpl', 'workflow-ts.yml.tmpl', 'workflow-py.yml.tmpl']) {
    const lang = tmpl.includes('-ts') ? 'ts' : tmpl.includes('-py') ? 'py' : 'generic';
    const out = await renderFile(join(TEMPLATES, tmpl), {
      REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: lang }),
    });
    // paths-check must emit `model` in its outputs block.
    assert.match(out, /model:\s*\$\{\{\s*steps\.classify\.outputs\.model\s*\}\}/,
      `${tmpl} paths-check must expose model output (v0.6.15)`);
    // The default MODEL inside the classifier is Sonnet — anything
    // un-classified must NOT silently route to a cheaper model.
    assert.match(out, /MODEL=claude-sonnet-4-6/,
      `${tmpl} default MODEL must be Sonnet (safety: trivial routing is opt-in by classifier)`);
  }
});

test('triviality classifier: dependabot/renovate bot authors route to Haiku', async () => {
  // The classifier hard-codes the two bot login names that exclusively
  // open dep-bump PRs. Adding new dep-bot authors would extend this case.
  const out = await renderFile(join(TEMPLATES, 'workflow.yml.tmpl'), {
    REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: 'generic' }),
  });
  assert.match(out, /dependabot\\\[bot\\\]\|renovate\\\[bot\\\]/,
    'classifier must match dependabot[bot] AND renovate[bot] (escaped for case glob)');
  assert.match(out, /MODEL=claude-haiku-4-5-20251001/,
    'classifier must assign Haiku 4.5 to trivial PRs');
});

test('triviality classifier: dep-manifest allow-list covers npm/pip/cargo/go/ruby', async () => {
  const out = await renderFile(join(TEMPLATES, 'workflow.yml.tmpl'), {
    REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: 'generic' }),
  });
  // Spot-check one pattern per ecosystem so regressions in the
  // allow-list are caught.
  for (const pat of [
    /package\.json/,
    /package-lock\.json/,
    /pyproject\.toml/,
    /poetry\.lock/,
    /uv\.lock/,
    /\bGemfile\b/,
    /go\.mod\b/,
    /go\.sum\b/,
    /Cargo\.toml/,
    /Cargo\.lock/,
  ]) {
    assert.match(out, pat, `triviality allow-list must include ${pat}`);
  }
});

test('triviality classifier: any non-allow-list file flips MODEL back to Sonnet (safety)', async () => {
  // The classifier's bail-out branch — `*) ALL_TRIVIAL=false; break ;;`
  // — must be present. Without it, a single feature-code file in the
  // diff would still route to Haiku, defeating the purpose.
  const out = await renderFile(join(TEMPLATES, 'workflow.yml.tmpl'), {
    REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: 'generic' }),
  });
  assert.match(
    out,
    /\*\)\s*ALL_TRIVIAL=false/,
    'mixed-diff guard must flip ALL_TRIVIAL=false when any non-manifest file appears',
  );
});

test('templateLanguage maps template filename to reviewPrompt language', () => {
  assert.equal(templateLanguage('workflow-ts.yml.tmpl'), 'ts');
  assert.equal(templateLanguage('workflow-py.yml.tmpl'), 'py');
  assert.equal(templateLanguage('workflow.yml.tmpl'), 'generic');
  assert.equal(templateLanguage('whatever-else.yml.tmpl'), 'generic');
});

test('rendered workflow.yml.tmpl puts review prompt in APPEND_SYSTEM_PROMPT env var (0.A.2 caching path)', async () => {
  // v0.A.2: review prompt moved from user-message `prompt:` to
  // `APPEND_SYSTEM_PROMPT` env var so Claude Code CLI's auto-cache
  // covers it. The user-message `prompt:` becomes a minimal directive.
  const out = await renderFile(join(TEMPLATES, 'workflow.yml.tmpl'), {
    REVIEW_PROMPT: reviewPrompt({
      projectDescription: 'TEST DESCRIPTION',
      language: 'generic',
    }),
  });
  // Project description appears at the right indent under APPEND_SYSTEM_PROMPT: |
  assert.match(out, /          APPEND_SYSTEM_PROMPT: \|\n            TEST DESCRIPTION\n/);
  // Mid-prompt content at 12-space indent (env-var YAML block scalar).
  // Sub-block markdown headers like "### Per-skill scan" sit at 14 spaces
  // (original prompt's sub-block had 2 extra leading spaces).
  assert.match(out, /\n            Review this pull request for critical issues only/);
  assert.match(out, /\n {14}### Per-skill scan\n/);
  // show_full_output: true is the measurement gate — exposes cache_*_input_tokens.
  assert.match(out, /\n          show_full_output: true\n/);
  // User-message prompt is now minimal — no longer the full 215-line block.
  assert.match(out, /          prompt: \|\n            Review this pull request following the discipline/);
});

test('rendered workflow-ts.yml.tmpl contains TypeScript bullets in APPEND_SYSTEM_PROMPT', async () => {
  const out = await renderFile(join(TEMPLATES, 'workflow-ts.yml.tmpl'), {
    REVIEW_PROMPT: reviewPrompt({
      projectDescription: 'TS PROJECT',
      language: 'ts',
    }),
  });
  // TS-specific bullet must appear under APPEND_SYSTEM_PROMPT, not prompt:
  assert.match(out, /APPEND_SYSTEM_PROMPT: \|/);
  assert.match(out, /\n            - TypeScript type safety issues/);
  assert.match(out, /\n          show_full_output: true\n/);
});

test('rendered workflow-py.yml.tmpl contains Python bullets (no generic test-coverage) in APPEND_SYSTEM_PROMPT', async () => {
  const out = await renderFile(join(TEMPLATES, 'workflow-py.yml.tmpl'), {
    REVIEW_PROMPT: reviewPrompt({
      projectDescription: 'PY PROJECT',
      language: 'py',
    }),
  });
  assert.match(out, /APPEND_SYSTEM_PROMPT: \|/);
  assert.match(out, /\n            - Incorrect exception handling/);
  // Python variant should NOT include the generic "Broken or missing test coverage" line.
  assert.doesNotMatch(out, /\n            - Broken or missing test coverage/);
});

// --- 0.0.O (v0.6.22): post-step identity contract ---
// REGRESSION GUARD: clud-bug-review on PR #114 caught that moving the
// summary post to a workflow step with `GH_TOKEN: secrets.GITHUB_TOKEN`
// attributes the comment to github-actions[bot], NOT claude[bot]. The
// strict-mode gate, per-skill check-runs, and incremental-diff handshake
// all filter on bot author — without these tests, a future template
// refactor could silently re-introduce the identity mismatch.

test('all 3 rendered workflow templates pass bot-login: github-actions[bot] to strict-mode-gate', async () => {
  for (const tmpl of ['workflow.yml.tmpl', 'workflow-ts.yml.tmpl', 'workflow-py.yml.tmpl']) {
    const out = await renderFile(join(TEMPLATES, tmpl), {
      REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: templateLanguage(tmpl) }),
    });
    assert.match(
      out,
      /strict-mode-gate@[^\n]+\n\s+with:\n\s+github-token: [^\n]+\n[\s\S]*?bot-login: 'github-actions\[bot\]'/,
      `${tmpl}: strict-mode-gate must receive bot-login: 'github-actions[bot]' since the summary is posted by the workflow post-step under that identity`,
    );
  }
});

test('all 3 rendered workflow templates: skip-advisory dedup query filters github-actions[bot]', async () => {
  // REGRESSION GUARD: clud-bug-review on PR #114 caught that the
  // Guard step's skip-dedup query filtered claude[bot] but the
  // accompanying gh pr comment posts under github-actions[bot]
  // (workflow GITHUB_TOKEN identity). The dedup returned 0 every
  // run, stacking duplicate "Clud Bug skipped" advisories on every
  // pull_request: synchronize on a long-running fork/bot PR.
  // Mirror of the strict-mode-gate identity contract — pin it.
  for (const tmpl of ['workflow.yml.tmpl', 'workflow-ts.yml.tmpl', 'workflow-py.yml.tmpl']) {
    const out = await renderFile(join(TEMPLATES, tmpl), {
      REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: templateLanguage(tmpl) }),
    });
    assert.match(
      out,
      /select\(\.user\.login == "github-actions\[bot\]" and \(\.body \| startswith\("## 🐛 Clud Bug skipped"\)\)\)/,
      `${tmpl}: skip-advisory dedup query must filter github-actions[bot] (the GITHUB_TOKEN identity), not claude[bot]`,
    );
  }
});

test('reviewPrompt: prior-summary detection block names github-actions[bot] (post-0.0.O identity)', () => {
  const out = reviewPrompt({ projectDescription: 'p' });
  // The LLM walks comments to find the prior summary for the incremental-
  // diff handshake. The summary is now posted by github-actions[bot].
  assert.match(out, /github-actions\[bot\] comments newest-first/);
  // Pre-v0.6.22 back-compat note: the prompt should mention that older
  // summaries are claude[bot]-authored so the LLM can still find them on
  // mid-version repos.
  assert.match(out, /Pre-v0\.6\.22 summaries are claude\[bot\]-authored/);
});

test('reviewPrompt: PR-comments fetch excludes BOTH claude[bot] and github-actions[bot]', () => {
  const out = reviewPrompt({ projectDescription: 'p' });
  // Otherwise the LLM reads back its own prior summary in the comments fetch,
  // wasting bytes and double-counting the review state.
  assert.match(out, /\.user\.login != "claude\[bot\]" and \.user\.login != "github-actions\[bot\]"/);
});

test('APPEND_SYSTEM_PROMPT content is byte-stable across reviews of different PRs (cache prerequisite)', async () => {
  // Caching only works if the cached prefix is BYTE-IDENTICAL across runs.
  // Two synthetic reviews of the same repo (same projectDescription, same
  // language) must produce byte-identical APPEND_SYSTEM_PROMPT sections.
  // Any per-PR data (numbers, timestamps, SHAs) leaking into the prefix
  // would invalidate the cache.
  const out1 = await renderFile(join(TEMPLATES, 'workflow.yml.tmpl'), {
    REVIEW_PROMPT: reviewPrompt({ projectDescription: 'X', language: 'generic' }),
  });
  const out2 = await renderFile(join(TEMPLATES, 'workflow.yml.tmpl'), {
    REVIEW_PROMPT: reviewPrompt({ projectDescription: 'X', language: 'generic' }),
  });
  // Extract just the APPEND_SYSTEM_PROMPT block from each rendered template.
  const extractAppend = (s) => s.match(/APPEND_SYSTEM_PROMPT: \|\n([\s\S]*?)\n        with:/m)[1];
  assert.equal(extractAppend(out1), extractAppend(out2));
});

// --- Indent-aware render.js behavior (added in v0.6.2 alongside prompts.js) ---

test('render preserves indentation for multi-line values', async () => {
  // Without indent-aware substitution, continuation lines would lose
  // their YAML indent and corrupt the `prompt: |` block. This is the
  // load-bearing test for render.js's multi-line handling.
  const { render } = await import('../lib/render.js');
  const tmpl = '          prompt: |\n            {{BODY}}\n';
  const out = render(tmpl, { BODY: 'line1\nline2\nline3' });
  assert.equal(out, '          prompt: |\n            line1\n            line2\n            line3\n');
});

test('render preserves blank lines without trailing whitespace in multi-line values', async () => {
  // Blank lines in the substituted value stay blank (no indent applied).
  // Keeps YAML output clean (no trailing whitespace on otherwise-blank
  // lines) which is also git-friendly.
  const { render } = await import('../lib/render.js');
  const tmpl = '            {{BODY}}\n';
  const out = render(tmpl, { BODY: 'line1\n\nline2' });
  assert.equal(out, '            line1\n\n            line2\n');
});
