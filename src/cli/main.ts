// @ts-nocheck
//
// src/cli/main.ts — top-level CLI command dispatch.
//
// Lifted verbatim from bin/clud-bug.js during the v0.7.0 TS migration
// (Wave 3 final commit). Per architect Risk R7, the 1359-LOC bin file
// would have cost 3-4h of type-annotation churn to convert under
// NodeNext strict mode; deferring with @ts-nocheck preserves the
// architectural goal — bin/clud-bug.js becomes a 3-line shim importing
// the compiled dist/cli/index.js — without the type-checking debt.
//
// Future cleanup: strip @ts-nocheck and annotate piece-by-piece in
// follow-up PRs (most functions take `args: Args` from parseArgs; the
// shape is stable across the file).

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { detect, buildDescriptionLine } from '../core/detect.js';
import { renderFile, pickTemplate, templateLanguage } from '../core/render.js';
import { reviewPrompt } from '../core/prompts.js';
import { SkillsClient, rankAndCap } from '../core/skills.js';
import {
  writeSkills, writeSkill, loadBaseline, loadDesignKit,
  readManifest, writeManifest, removeSkill, listInstalled, diffManifest,
} from './skills.js';
import { computeAuditFileSet } from './audit.js';
import { renderAuditHeader } from '../core/audit.js';
import { runUpdate } from './update.js';
import { runReviewPrompt } from './review-prompt.js';
import { runReview, runReviewDone } from './review.js';
import { runPostCheckRun } from './post-check-run.js';
import { runBuildBundle } from './build-bundle.js';
import { getPendingWorkflowEdits, makeBranchName, git as gitCmd } from './edit-workflow.js';
import { applyToRepo as applyAgentDocs } from './agents-md.js';
import { detectRepo, detectDefaultBranch, getProtectionState, enableConversationResolution } from './branch-protection.js';
import { computeReviewCost, costPerLOC, cacheHitRate, extractTokensFromLog, rollup, formatRollup } from './usage.js';

// PKG_ROOT resolution: this file is compiled to dist/cli/main.js, so two
// dirname() calls climb from `<pkg>/dist/cli/main.js` → `<pkg>/dist` →
// `<pkg>` (the package root). Previously bin/clud-bug.js used the same
// two-dirname pattern from `<pkg>/bin/clud-bug.js`.
const PKG_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const TEMPLATES = join(PKG_ROOT, 'templates');
const BASELINE_DIR = join(TEMPLATES, 'skills', 'baseline');
const DESIGN_DIR = join(TEMPLATES, 'skills', 'design');

function parseArgs(argv) {
  const args = {
    _: [], offline: false, acceptAll: false, commit: false, help: false, version: false,
    since: null, changedIn: null, scopes: [], out: null,
    setProtection: true, quiet: false,
    // 0.0.M.1 (v0.6.13): `clud-bug usage` flags.
    repo: null, pr: null, limit: null, json: false,
    // 0.0.O (v0.6.22): `clud-bug render` reads its payload from stdin.
    stdin: false,
    // v0.6.30: cross-review aggregation read source for `usage --health`.
    // Defaults to true (artifact mode); `--no-artifacts` forces local
    // .clud-bug.json read (matches v0.6.28 behavior).
    artifacts: true,
    // v0.6.33: unified-install mirror — `clud-bug init --with-skdd` also
    // subprocesses to `pip install logmind && logmind init` so Node-first
    // users get the same one-command bootstrap as Python-first users
    // (logmind v0.6.8's --with-skdd is the symmetric counterpart).
    withSkdd: false,
    // v0.7.0 (Wave 6b): `clud-bug init --with-local-review` also scaffolds
    // .claude/commands/clud-bug-review.md so `/clud-bug-review` works in a
    // Claude Code session (reviews the current PR with the session's tokens).
    withLocalReview: false,
    // Phase ZP3: `clud-bug init` now installs BOTH the max-mode commit hook AND
    // the GitHub Action enforcer by DEFAULT (was off-by-default) — the two are
    // complementary (the hook reviews on your session's subscription at commit
    // time; the Action gates the merge on CI). Opt out of the hook with
    // `--no-hooks`. `--local-only` (max mode, no Action) still forces it on.
    withHooks: true,
    // #276 (SPEC 2.0 §4.1): "Where it is enabled, the repository chooses when:
    // after a commit, or before a push. A reviewer MUST support both, and push
    // is the default." `null` here means "unset" and resolves to 'push' at
    // install time; `commit` restores the pre-#276 surface; `both` installs
    // each.
    hookTrigger: null,
    // rc.16: `clud-bug init --with-design` installs the design-critic kit
    // (4 `kind: design` skills) and flips the off-by-default `design` block to
    // enabled so the visual review lens runs (local recipe + hosted bot).
    withDesign: false,
    // rc.18: `clud-bug init --local-only` installs MAX MODE (skills + slash
    // command + commit hook), but SKIPS the GitHub Action workflows (which run
    // claude-code-action with ANTHROPIC_API_KEY). For repos that review on a
    // Claude subscription via the in-session hook, not a billed CI Action.
    // Implies --with-local-review + --with-hooks.
    localOnly: false,
    // v0.7.0-rc.4: `clud-bug configure-github` flags.
    // --dry-run prints the diff but skips PATCH; --branch overrides "main".
    // --preset selects the vendored ruleset variant (default: skdd).
    dryRun: false,
    branch: null,
    preset: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--offline') args.offline = true;
    else if (a === '--accept-all' || a === '-y') args.acceptAll = true;
    else if (a === '--commit') args.commit = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else if (a === '--quiet' || a === '-q') args.quiet = true;
    else if (a === '--since') args.since = argv[++i];
    else if (a === '--changed-in') args.changedIn = argv[++i];
    else if (a === '--scope') args.scopes.push(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--no-set-protection') args.setProtection = false;
    else if (a === '--repo') args.repo = argv[++i];
    else if (a === '--pr') args.pr = Number(argv[++i]);
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--json') args.json = true;
    else if (a === '--stdin') args.stdin = true;
    else if (a === '--health') args.health = true;
    else if (a === '--no-artifacts') args.artifacts = false;
    else if (a === '--with-skdd') args.withSkdd = true;
    else if (a === '--with-local-review') args.withLocalReview = true;
    else if (a === '--with-hooks') args.withHooks = true;
    // Phase ZP3: negation of the now-default commit hook (mirrors --no-strict /
    // --no-artifacts). --local-only re-forces it on (max mode IS the hook).
    else if (a === '--no-hooks') args.withHooks = false;
    else if (a === '--with-design') args.withDesign = true;
    else if (a === '--local-only') args.localOnly = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--branch') args.branch = argv[++i];
    else if (a === '--preset') args.preset = argv[++i];
    else if (a === '--trigger') args.trigger = argv[++i];
    // #276: the `pre-push` hook forwards the range it computed for the refs
    // being pushed. Validated by `sanitizeRange` before it reaches the recipe.
    else if (a === '--range') args.range = argv[++i];
    // #276: which local-review surface `init --with-hooks` installs.
    // Defaults to `push` (SPEC 2.0 §4.1: "push is the default").
    else if (a === '--hook-trigger') args.hookTrigger = argv[++i];
    else if (a === '--diff-size') args.diffSizeBytes = Number(argv[++i]);
    // #240 vector 2: the commit-review hook forwards this when the
    // triggering command carried `--no-verify`; `review-prompt` only renders
    // the finding if the repo also declares mandated hooks.
    else if (a === '--flag-no-verify') args.flagNoVerify = true;
    // #239: `clud-bug review --pending` drains the durable queue.
    else if (a === '--pending') args.pending = true;
    // H3: `clud-bug post-check-run` flags.
    else if (a === '--sha') args.sha = argv[++i];
    else if (a === '--verdict') args.verdict = argv[++i];
    // SPEC §6.5: `--verdict skipped` MUST say why. Free text, rendered into the
    // neutral check's summary.
    else if (a === '--skip-reason') args.skipReason = argv[++i];
    else if (a === '--critical-count') args.criticalCount = Number(argv[++i]);
    else if (a === '--source') args.source = argv[++i];
    else if (a === '--strict') args.strict = true;
    else if (a === '--no-strict') args.strict = false;
    else if (a === '--notary') args.notary = true;
    else if (a === '--no-notary') args.notary = false;
    else if (a === '--owner') args.owner = argv[++i];
    else if (a === '--details-url') args.detailsUrl = argv[++i];
    // Phase Z: notary attestation bundle (JSON path) for `post-check-run`.
    else if (a === '--bundle') args.bundle = argv[++i];
    // Phase ZP3: `clud-bug build-bundle` provenance flag.
    else if (a === '--recipe-version') args.recipeVersion = argv[++i];
    else args._.push(a);
  }
  return args;
}

const HELP = `clud-bug 🐛 — a field guide to specimens crawling your code

Usage:
  npx clud-bug <command> [options]

Commands:
  init                  Open field season: survey the repo, pin baseline specimens, write the workflows.
                        Pass \`--with-skdd\` to also install logmind in one go (requires Python + pip).
  list                  Show your collection (baseline / from skills.sh / custom).
  add <source/name>     Pin one new specimen from skills.sh (e.g. vercel-labs/skills/next-best-practices).
  remove <slug>         Unpin a clud-bug-managed specimen (refuses to touch your custom ones).
  refresh               Re-survey, diff against your collection, prompt to update.
  audit                 Walk the whole habitat (or a recent slice) and prepare a report stub.
                        Use --since / --changed-in / --scope to narrow.
  update                Re-render workflows + refresh baseline specimens to the latest shipped
                        templates. Custom and skills.sh-installed specimens left alone.
  configure-github <owner>/<repo>
                        One-stop repo setup: repo conveniences (squash-only merges,
                        auto-merge, delete-branch-on-merge, PR title/body squash
                        message — ALL presets) + the SPEC §7 canonical branch
                        ruleset. \`--preset baseline|clud-bug|skdd|public-guard\`
                        picks the variant (default: skdd). Auth: GITHUB_TOKEN env
                        first, then \`gh auth token\`. Use --dry-run to print the
                        diff without writing; --branch to target a non-main branch.
                        Idempotent — already-canonical repos exit 0 with no changes.
  edit-workflow         Helper for editing .github/workflows/clud-bug-*.yml in an isolated
                        PR (the action refuses to review PRs that modify its own workflow).
  usage                 Read recent clud-bug-review run JSON + normalize cost per LOC.
                        Internal Q7-clud-bug enforcement dashboard. Reports cache hit
                        rate, 30-day rolling \$/LOC trend, per-repo/per-model
                        distributions, and outliers (> 2x org median).
                        Use --pr / --repo / --since / --limit / --json to filter.
  usage --health        Deterministic skill-health dashboard. Renders archive-
                        candidate / stale / new / healthy status per skill, applying
                        the v0.6.28 thresholds (citations==0 + loads>=5 → archive
                        candidate; last cited >60d → stale; etc.). Read-only —
                        humans decide what to prune.
                        Read source (v0.6.30): by default, walks
                        \`clud-bug-skill-usage-pr-*\` workflow artifacts uploaded
                        by every clud-bug-review run and accumulates them into
                        one org-level snapshot. Pass \`--repo owner/name\` to
                        target a specific repo; otherwise infers from the local
                        git remote. \`--no-artifacts\` falls back to reading the
                        local \`.claude/skills/.clud-bug.json\` (v0.6.28 behavior).
  eval                  Run the golden-set regression gate against the rendered review
                        prompt (must-contain / must-not-contain / byte-budget). Same as
                        \`node --test test/prompts.eval.test.js\` but works from any cwd.
  update-skill-usage    Update the .claude/skills/.clud-bug.json usage block from
                        a structured-output JSON payload (the action's
                        \`outputs.structured_output\`). Called as a workflow
                        post-step alongside \`render\` (v0.6.29 / Component 4).
                        Pipe the JSON to stdin. Idempotent + atomic write.
                        Silent no-op on empty stdin (parity with \`render\`).
  render --stdin        Render a structured-output JSON payload (the action's
                        \`outputs.structured_output\`, piped via stdin) to the
                        GitHub-markdown summary comment shape. Invoked by the
                        workflow post-step; output is what \`gh pr comment\`
                        receives. Empty stdin or non-object payload exits 2.
  select-review-event   Compute the SPEC §7.2.1 formal-review event (APPROVE /
   --stdin               REQUEST_CHANGES / COMMENT / skip) from a structured-output
                        JSON payload + a few env-passed PR-author fields. Used by
                        the v0.7.0-rc.3 workflow post-step to post a formal
                        \`pulls.createReview\` call so the canonical ruleset's
                        \`required_approving_review_count: 1\` floor is auto-
                        satisfied by clud-bug[bot] on clean reviews.
                        Required env vars: PR_AUTHOR_LOGIN, PR_AUTHOR_ASSOCIATION,
                        STRICT_MODE ("true"/"false"). Empty/malformed stdin →
                        exits 0 with "skip" on stdout (no-op; workflow degrades
                        gracefully to the existing comment-only behavior).
  post-inline-threads   Post per-finding inline review threads (D.2.X). Reads a
   --stdin               structured-output JSON payload from stdin, fetches the
                        PR diff via \`gh api\`, posts one batched review with one
                        comment per anchorable finding. Each comment body carries
                        a hidden \`<!-- finding-id: <hash> --> \`marker so Wave 5b
                        auto-resolve can re-match findings on subsequent pushes
                        without persistent state. Required env vars: GH_TOKEN,
                        REPO ("owner/name"), PR_NUMBER, HEAD_SHA. Output is a
                        JSON status report \`{posted, skipped, preexisting, error?}\`.
  resolve-threads       Auto-resolve inline review threads when a fix-push
                        addresses the original finding (D.2.6). Fetches all
                        bot-authored unresolved threads, asks the Anthropic
                        Messages API per-thread whether the new commit addressed
                        the concern, then resolves (with a marker reply)
                        ADDRESSED threads + leaves UNCERTAIN/NOT_ADDRESSED open.
                        Fail-closed: verifier errors route to UNCERTAIN.
                        Required env vars: GH_TOKEN, ANTHROPIC_API_KEY,
                        REPO ("owner/name"), PR_NUMBER. Output: JSON
                        \`{actions, verifierCallCount, shouldRequestChanges}\`.
  review-prompt         Emit the local-review recipe — the structured prompt a
                        Claude Code agent/hook runs to review the current diff on
                        the session's own subscription. Plans via the shared
                        engine: --trigger commit (default) → a fast single pass;
                        push/pr → the full multi-pass plan. Prints to stdout.
                        --flag-no-verify (set by the commit-review hook when
                        the triggering command carried \`--no-verify\`) renders
                        an automatic finding IF this repo declares mandated
                        hooks (\`.logmind/\` or an AGENTS.md mentioning "hook").
  review --pending      Drain \`.git/clud-bug-pending\` (#239): prints one
                        recipe per queued sha (oldest first) — a review that
                        deferred under a usage limit or a recipe-fetch error —
                        then clears the queue. Follow each recipe, then run
                        \`clud-bug review-done <sha>\` for each.
  review-done [sha]     The two-phase-marker completion step (#239): the
                        commit-review hook's recipe instructs the agent to run
                        this once it ACTUALLY finishes reviewing a commit — a
                        \`fired\` marker with no matching \`done\` re-fires on the
                        next hook trigger (a usage-limit-killed session is
                        never mistaken for a completed review). Defaults to
                        HEAD when no sha is given.
  post-check-run        Post the \`clud-bug-review\` GitHub check so branch
                        protection can gate the merge (H3). --verdict
                        clean|critical|failed|unverified|skipped --sha <sha>
                        [--critical-count N] [--skip-reason "..."]
                        [--source local|ci] [--strict|--no-strict]
                        [--notary|--no-notary] [--dry-run].
                        clean→success, critical+strict→failure, else neutral.
                        \`skipped\` is SPEC §6.5 — no review ran (fork PR, or a
                        propagation diff with no review surface). It posts
                        neutral and names the cause; never a green.
                        With CLUD_BUG_NOTARY_URL set + --bundle <file>, submits a
                        notary attestation bundle instead (Phase Z); the notary
                        issues the check. Falls back to the self-attested post if
                        the endpoint is unreachable.
  build-bundle          Transform a review's structured_output JSON (piped via
   --stdin               stdin) into a notary attestation bundle (Phase ZP3), for
                        the self-hosted Action to hand to \`post-check-run
                        --bundle\`. Flattens critical/minor/preexisting findings,
                        derives the verdict from the critical count (not the
                        self-reported counts), and derives coverage from a fresh
                        \`gh pr diff <pr> --name-only\`. Flags: --repo owner/name
                        --pr N --sha <sha> --recipe-version <v>. Emits bundle
                        JSON to stdout.

Options:
  --offline             Skip skills.sh; pin only the bundled baseline specimens.
  --accept-all,-y       Accept the recommended specimens without prompting.
  --commit              git add + commit the generated kit when done (init only).
  --with-local-review   (init) Scaffold .claude/commands/clud-bug-review.md so
                        \`/clud-bug-review\` works in a Claude Code session —
                        reviews the current branch's PR using that session's
                        own tokens (no hosted App, no extra auth).
  --with-hooks          (init) Install the local review surface. Implies
                        --with-local-review. ON by default (ZP3) — \`init\`
                        installs both the hook and the GitHub Action enforcer.
                        Which surface it installs is --hook-trigger.
  --hook-trigger <when> (init) push (default) | commit | both. SPEC 2.0 §4.1:
                        "the repository chooses when: after a commit, or before
                        a push … push is the default".
                          push   — a git \`pre-push\` hook (§6.7). Runs the repo's
                                   declared test command first, then prints the
                                   \`review-prompt --trigger push\` command for the
                                   range being pushed. Only a failing declared
                                   test blocks; the review is advisory (§4.1).
                          commit — the Claude Code \`type: command\` PostToolUse
                                   hook in .claude/settings.json: on every
                                   \`git commit\` / \`logmind log\` it fetches a
                                   recipe and surfaces it via asyncRewake.
                          both   — install each.
  --no-hooks            (init) Skip the local review surface entirely — install
                        only the GitHub Action enforcer (+ skills). --local-only
                        overrides (max mode IS the hook, so it stays installed).
  --with-design         (init) Install the design-critic kit (4 \`kind: design\`
                        skills) and enable the off-by-default visual review
                        lens — renders changed UI and critiques it. Off by default.
  --local-only          (init) MAX MODE: install the slash command + commit hook
                        (implies --with-local-review + --with-hooks) but SKIP the
                        GitHub Action workflows. Reviews run in your Claude Code
                        session on your subscription — no API key, no per-review bill.
  --quiet,-q            Token-frugal mode for agent invocations. Suppresses
                        progress chatter; emits exactly one final
                        \`ok <key-value>\` summary line per command. Errors
                        and warnings still print. Also honored via the
                        CLUD_BUG_QUIET=1 env var.
  --no-set-protection   Skip the prompt that offers to enable
                        required_conversation_resolution on the default
                        branch (init only). Use for repos that manage
                        branch protection via ruleset or org policy.
  --dry-run             Print the canonical-v1 diff without writing
                        (configure-github only).
  --branch <name>       Target branch for configure-github (default: main).
  --preset <name>       configure-github ruleset preset: baseline | clud-bug |
                        skdd | public-guard (default: skdd).
  --trigger <ctx>       review-prompt context: push (default) | commit | pr.
                        (§4.1 makes push the default; it was commit before #276.)
  --range <a>..<b>      review-prompt: the exact range to review on a \`push\`
                        trigger. The pre-push hook fills this in from the refs
                        git is about to publish; one review of the range, never
                        one per commit.
  --repo <owner/name>   Restrict \`usage\` to a single repo. Default: all repos
                        with clud-bug-review.yml in the gh user's auth scope.
  --pr <N>              Restrict \`usage\` to a single PR.
  --limit <N>           Max reviews to fetch (default 50; the API caps).
  --json                Emit JSON instead of human-readable output.
                        Compatible with --quiet for pipeline consumption.
  --since <date>        Audit only files changed in commits after <date> (git date string).
  --changed-in <dur>    Audit only files changed in the past <dur>: 7d, 2w, 1mo, 1y. (audit only)
  --scope <glob>        Limit audit to files matching <glob>; repeatable. (audit only)
  --out <path>          Where to write the audit stub. Default: audits/YYYY-MM-DD.md
  --help,-h             Show this help.
  --version,-v          Show version.
`;

async function readPkgVersion() {
  const pkg = JSON.parse(await readFile(join(PKG_ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(HELP); return; }
  if (args.version) { process.stdout.write((await readPkgVersion()) + '\n'); return; }
  if (args.quiet) setQuiet(true);

  const cmd = args._[0];

  // rc.20 — update notifier (brew/gh/vercel pattern). Only on an interactive
  // terminal, and never for the machine-consumed verbs (the hook runs
  // review-prompt in a non-TTY subprocess, so this is doubly skipped there).
  // Best-effort + cache-backed, so it adds no latency to the command.
  const MACHINE_VERBS = new Set(['review-prompt', 'review', 'review-done', 'post-check-run', 'build-bundle', 'render', 'update-skill-usage']);
  if (process.stderr.isTTY && !MACHINE_VERBS.has(cmd)) {
    const { maybeNotifyUpdate } = await import('./update-notifier.js');
    await maybeNotifyUpdate(await readPkgVersion());
  }

  switch (cmd) {
    case 'init':    return runInit(args);
    case 'list':    return runList(args);
    case 'add':     return runAdd(args);
    case 'remove':  return runRemove(args);
    case 'refresh': return runRefresh(args);
    case 'audit':   return runAudit(args);
    case 'update':  return runUpdateCmd(args);
    case 'edit-workflow': return runEditWorkflow(args);
    case 'configure-github': return runConfigureGithubCmd(args);
    case 'usage':   return runUsage(args);
    case 'eval':    return runEval();
    case 'render':  return runRender(args);
    case 'update-skill-usage': return runUpdateSkillUsage(args);
    case 'select-review-event': return runSelectReviewEvent(args);
    case 'post-inline-threads': return runPostInlineThreads(args);
    case 'resolve-threads': return runResolveThreads(args);
    case 'review-prompt': return runReviewPrompt(args);
    case 'review': return runReview(args);
    case 'review-done': return runReviewDone(args);
    case 'post-check-run': return runPostCheckRun(args);
    case 'build-bundle': return runBuildBundle(args);
    default:
      process.stderr.write(`Unknown command: ${cmd || '(none)'}\n\n${HELP}`);
      process.exit(2);
  }
}

// 0.0.O (v0.6.22): render a structured-output JSON payload to the
// GitHub-markdown summary comment shape. Called by the post-step
// in the workflow templates: it reads the action's
// `outputs.structured_output` (one bundled JSON string), pipes it
// to stdin here, and we emit the rendered markdown on stdout for
// the shell to pass to `gh pr comment --body`.
//
// Usage: `clud-bug render --stdin` (only input source supported).
// Exit code: 0 on success, 2 on JSON parse error or non-object payload.
async function runRender(args) {
  const { renderReview } = await import('../core/render-review.js');
  if (!args.stdin) {
    process.stderr.write('clud-bug render: --stdin is required (the only supported input source).\n');
    process.exit(2);
  }
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  raw = raw.trim();
  if (!raw) {
    // Empty structured_output → post-step is supposed to skip the
    // render. Surface the situation rather than silently producing an
    // empty comment.
    process.stderr.write('clud-bug render: stdin was empty — nothing to render.\n');
    process.exit(2);
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`clud-bug render: JSON parse failed: ${e.message}\n`);
    process.exit(2);
  }
  try {
    process.stdout.write(renderReview(payload));
  } catch (e) {
    process.stderr.write(`clud-bug render: ${e.message}\n`);
    process.exit(2);
  }
}

// v0.6.29 — Component 4. Pipe the action's structured_output through
// the skill-usage data layer (v0.6.28) + write the merged result back
// to .claude/skills/.clud-bug.json atomically.
//
// Workflow integration (post-step in workflow.yml.tmpl):
//
//     echo "${{ steps.review.outputs.structured_output }}" \
//       | npx clud-bug@latest update-skill-usage --stdin
//
// Runs AFTER the render post-step. Silent no-op on empty stdin
// (same contract as `render` — preserves the workflow's existing
// "skip both if empty" branch). Idempotent: running on the same JSON
// twice produces the same result.
async function runUpdateSkillUsage(args) {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const {
    computeSkillUsageDelta,
    mergeSkillUsage,
  } = await import('./skill-usage.js');

  if (!args.stdin) {
    process.stderr.write('clud-bug update-skill-usage: --stdin is required.\n');
    process.exit(2);
  }

  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  raw = raw.trim();
  if (!raw) {
    // Empty structured_output → render is also skipped → nothing to
    // update. Match the render contract: exit 0 with a stderr note.
    process.stderr.write('clud-bug update-skill-usage: stdin empty — no usage update.\n');
    return;
  }

  let reviewJson;
  try {
    reviewJson = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`clud-bug update-skill-usage: invalid JSON: ${e.message}\n`);
    process.exit(2);
  }
  if (!reviewJson || typeof reviewJson !== 'object') {
    process.stderr.write('clud-bug update-skill-usage: payload must be a JSON object.\n');
    process.exit(2);
  }

  // Compute per-review delta. Empty delta is fine — just means no
  // skills loaded or cited (workflow-only PRs, e.g.).
  const delta = computeSkillUsageDelta(reviewJson);
  if (Object.keys(delta).length === 0) {
    process.stderr.write('clud-bug update-skill-usage: no skills in payload — nothing to record.\n');
    return;
  }

  // Read existing .clud-bug.json. The path is canonical:
  // .claude/skills/.clud-bug.json relative to cwd (the workflow runs
  // from the repo root).
  const jsonPath = path.resolve(process.cwd(), '.claude', 'skills', '.clud-bug.json');
  let parsed;
  try {
    const existingRaw = await fs.readFile(jsonPath, 'utf-8');
    parsed = JSON.parse(existingRaw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      process.stderr.write(
        `clud-bug update-skill-usage: no .clud-bug.json at ${jsonPath} — skipping. ` +
        `Run \`npx clud-bug init\` first.\n`
      );
      return;
    }
    process.stderr.write(`clud-bug update-skill-usage: parse failed: ${err.message}\n`);
    process.exit(2);
  }
  if (!parsed || typeof parsed !== 'object') {
    process.stderr.write('clud-bug update-skill-usage: .clud-bug.json malformed.\n');
    process.exit(2);
  }

  const existingUsage = parsed.usage || {};
  const timestamp = new Date().toISOString();
  const mergedUsage = mergeSkillUsage(existingUsage, delta, timestamp);
  parsed.usage = mergedUsage;

  // Write back ATOMICALLY: temp file + rename. Guards against a
  // crashed write leaving the JSON half-written + unparseable on next
  // read (which would brick the entire skill catalog).
  const tmpPath = jsonPath + '.tmp';
  const serialized = JSON.stringify(parsed, null, 2) + '\n';
  await fs.writeFile(tmpPath, serialized, 'utf-8');
  await fs.rename(tmpPath, jsonPath);

  const skillCount = Object.keys(delta).length;
  ok(`update-skill-usage: merged ${skillCount} skill${skillCount === 1 ? '' : 's'} from review`);
}


// v0.7.0-rc.3 — SPEC §7.2.1 formal-review event selector for the npm
// workflow path. Reads the action's structured_output JSON from stdin,
// PR-author metadata from env, and emits ONE word on stdout:
//
//     APPROVE | REQUEST_CHANGES | COMMENT | skip
//
// The workflow template post-step pipes the structured_output payload
// in, reads the verdict, then conditionally calls `gh api ... /reviews`
// with `event=$VERDICT` (skipping the API call when verdict is "skip").
//
// Robustness contract: this command MUST NEVER fail the workflow on
// caller-side problems (missing/malformed payload, missing env). Any
// such case prints "skip" to stdout + a warning to stderr and exits 0
// — the workflow then degrades to the existing comment-only behavior.
// We only exit non-zero on programmer error (unknown command flags),
// which the workflow templates don't pass.
//
// Required env vars (the workflow templates set all four):
//   PR_AUTHOR_LOGIN          — github.event.pull_request.user.login
//   PR_AUTHOR_ASSOCIATION    — github.event.pull_request.author_association
//   STRICT_MODE              — "true" / "false" from the base-ref manifest
// (PR_AUTHOR_ASSOCIATION missing → "CONTRIBUTOR" default which preserves
// pre-§7.2.1 trusted-author semantics; PR_AUTHOR_LOGIN missing → "skip".)
async function runSelectReviewEvent(args) {
  const { selectReviewEvent } = await import('../core/formal-review.js');

  if (!args.stdin) {
    process.stderr.write(
      'clud-bug select-review-event: --stdin is required.\n',
    );
    process.stdout.write('skip\n');
    return;
  }

  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  raw = raw.trim();
  if (!raw) {
    process.stderr.write(
      'clud-bug select-review-event: stdin empty — emitting "skip".\n',
    );
    process.stdout.write('skip\n');
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(
      `clud-bug select-review-event: JSON parse failed: ${e.message} — emitting "skip".\n`,
    );
    process.stdout.write('skip\n');
    return;
  }
  if (!payload || typeof payload !== 'object') {
    process.stderr.write(
      'clud-bug select-review-event: payload must be a JSON object — emitting "skip".\n',
    );
    process.stdout.write('skip\n');
    return;
  }

  // Count findings from the structured_output array shape. Each is
  // optional — the model may emit absent / null / wrong-type arrays
  // when its output drifts from schema; we tolerate all of those.
  const criticalCount = Array.isArray(payload.critical_findings)
    ? payload.critical_findings.length
    : 0;
  const minorCount = Array.isArray(payload.minor_findings)
    ? payload.minor_findings.length
    : 0;

  // Env-passed metadata. Empty PR_AUTHOR_LOGIN means we have no idea
  // who opened the PR — safer to skip than to attempt a formal review
  // that might collide with the self-PR guard mis-routed.
  const prAuthorLogin = String(process.env.PR_AUTHOR_LOGIN ?? '').trim();
  if (prAuthorLogin === '') {
    process.stderr.write(
      'clud-bug select-review-event: PR_AUTHOR_LOGIN unset — emitting "skip".\n',
    );
    process.stdout.write('skip\n');
    return;
  }

  // author_association resolution — security-critical fallback ladder.
  //
  // SPEC §7.2.1 + clud-bug-review #163 feedback: the §7.2.1 gate exists
  // precisely so a future REST-API rename of an external tier doesn't
  // silently degrade to "trusted → APPROVE". The fallback below splits
  // the two error cases by what they MEAN:
  //
  //   1. EMPTY ("") — caller didn't pass author_association at all.
  //      This is the "older webhook payload / non-GH caller" case.
  //      Pre-§7.2.1, those callers got APPROVE on clean reviews; we
  //      preserve that by defaulting to 'CONTRIBUTOR' (org-trusted).
  //      Documented + tested under "missing PR_AUTHOR_ASSOCIATION".
  //
  //   2. NON-EMPTY UNRECOGNIZED ("FUTURE_TIER") — caller passed a
  //      token this build doesn't know about. This is the rename
  //      scenario the §7.2.1 gate is explicitly defending against.
  //      Fail CLOSED: treat as external → 'NONE' → COMMENT, NEVER
  //      APPROVE. If the rename was for a still-trusted tier (e.g.
  //      'STAFF'), the cost is one extra COMMENT review pending
  //      human approval; if it was a new external tier, we've closed
  //      the drive-by exploit. Asymmetric risk → fail closed.
  const rawAssoc = String(process.env.PR_AUTHOR_ASSOCIATION ?? '').trim();
  const validAssociations = new Set([
    'OWNER', 'MEMBER', 'COLLABORATOR', 'CONTRIBUTOR',
    'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'NONE', 'MANNEQUIN',
  ]);
  let authorAssociation;
  if (rawAssoc === '') {
    // Back-compat for legacy callers without author_association.
    authorAssociation = 'CONTRIBUTOR';
  } else if (validAssociations.has(rawAssoc)) {
    authorAssociation = rawAssoc;
  } else {
    // Fail-closed for unrecognized future tokens. 'NONE' is the
    // weakest external tier and the safest default — selectReviewEvent
    // routes it to COMMENT (never APPROVE, never REQUEST_CHANGES).
    process.stderr.write(
      `clud-bug select-review-event: unrecognized PR_AUTHOR_ASSOCIATION="${rawAssoc}" — treating as external (fail-closed per SPEC §7.2.1).\n`,
    );
    authorAssociation = 'NONE';
  }

  const strictMode = String(process.env.STRICT_MODE ?? '').trim() === 'true';

  const event = selectReviewEvent({
    criticalCount,
    minorCount,
    strictMode,
    prAuthorLogin,
    authorAssociation,
  });
  process.stdout.write(event + '\n');
}


// Wave 5a / 0.7.0-rc.7: post per-finding inline review threads (D.2.X)
// to the PR.  Replaces the legacy "one summary comment listing every
// finding" UX with first-class GitHub review threads users can reply to
// and (in Wave 5b) the bot can auto-resolve on fix-push.
//
// Pipeline:
//   1. Read the structured review JSON from stdin (same shape the
//      `render` and `update-skill-usage` verbs consume).
//   2. Fetch the PR's per-file diff via `gh api repos/.../pulls/N/files`.
//   3. Call `planInlineThreads(findings, diffFiles)` from
//      `clud-bug/core/inline-threads` to partition into anchored
//      `comments[]` + skipped + preexisting buckets.
//   4. If any comments survive: POST one batched review via
//      `gh api -X POST repos/.../pulls/N/reviews` with `event: COMMENT`.
//      Each comment body carries a hidden `<!-- finding-id: <hash> -->`
//      marker so Wave 5b auto-resolve can re-derive the same ids on
//      subsequent pushes without a persistent store.
//   5. Emit a JSON summary on stdout (`{posted, skipped, preexisting}`).
//
// Required env vars (the workflow template provides all of them):
//   GH_TOKEN, REPO ("owner/name"), PR_NUMBER, HEAD_SHA
//
// Failure posture: any `gh api` failure is logged to stderr + emitted in
// the stdout JSON as `error`, but the verb exits 0 so the surrounding
// workflow step's `continue-on-error: true` is the single source of
// failure semantics. Mirrors the `render` / `update-skill-usage` posture.
async function runPostInlineThreads(args) {
  const { planInlineThreads } = await import('../core/inline-threads.js');

  if (!args.stdin) {
    process.stderr.write(
      'clud-bug post-inline-threads: --stdin is required.\n',
    );
    process.stdout.write(JSON.stringify({ posted: 0, skipped: [], preexisting: [], error: 'no-stdin' }) + '\n');
    return;
  }

  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  raw = raw.trim();
  if (!raw) {
    process.stderr.write(
      'clud-bug post-inline-threads: stdin empty — no-op.\n',
    );
    process.stdout.write(JSON.stringify({ posted: 0, skipped: [], preexisting: [], error: 'empty-stdin' }) + '\n');
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(
      `clud-bug post-inline-threads: JSON parse failed: ${e.message} — no-op.\n`,
    );
    process.stdout.write(JSON.stringify({ posted: 0, skipped: [], preexisting: [], error: 'parse-failed' }) + '\n');
    return;
  }
  if (!payload || typeof payload !== 'object') {
    process.stderr.write(
      'clud-bug post-inline-threads: payload must be a JSON object — no-op.\n',
    );
    process.stdout.write(JSON.stringify({ posted: 0, skipped: [], preexisting: [], error: 'not-object' }) + '\n');
    return;
  }

  // Pull findings from the structured_output shape — same field names as
  // the SPEC §1.8.1 review schema the model emits.
  const findings = [];
  for (const f of Array.isArray(payload.critical_findings) ? payload.critical_findings : []) {
    if (f && typeof f === 'object') {
      findings.push({ ...f, severity: 'critical' });
    }
  }
  for (const f of Array.isArray(payload.minor_findings) ? payload.minor_findings : []) {
    if (f && typeof f === 'object') {
      findings.push({ ...f, severity: 'minor' });
    }
  }
  // `preexisting_findings` are intentionally not threaded (informational
  // about prior code; not a reason to block this PR). `planInlineThreads`
  // partitions them into the `preexisting` bucket if any are included, but
  // the workflow path doesn't ship them — keep the payload focused.

  if (findings.length === 0) {
    process.stdout.write(JSON.stringify({ posted: 0, skipped: [], preexisting: [], reason: 'no-findings' }) + '\n');
    return;
  }

  // Required env vars.
  const repo = String(process.env.REPO ?? '').trim();
  const prNumberRaw = String(process.env.PR_NUMBER ?? '').trim();
  const headSha = String(process.env.HEAD_SHA ?? '').trim();
  const prNumber = Number(prNumberRaw);
  if (!repo || !repo.includes('/') || !Number.isInteger(prNumber) || prNumber <= 0 || !headSha) {
    process.stderr.write(
      `clud-bug post-inline-threads: REPO + PR_NUMBER + HEAD_SHA env vars required (got REPO=${repo}, PR_NUMBER=${prNumberRaw}, HEAD_SHA=${headSha ? '<set>' : '<unset>'}).\n`,
    );
    process.stdout.write(JSON.stringify({ posted: 0, skipped: [], preexisting: [], error: 'missing-env' }) + '\n');
    return;
  }

  // Fetch the PR's diff. `gh api repos/.../pulls/N/files --paginate`
  // returns a JSON array of {filename, patch, status, ...}. The single
  // -slurp on multi-page output stitches all pages into one big array.
  const filesResult = spawnSync(
    'gh',
    [
      'api',
      `repos/${repo}/pulls/${prNumber}/files`,
      '--paginate',
      '--slurp',
    ],
    { encoding: 'utf8' },
  );
  if (filesResult.status !== 0) {
    process.stderr.write(
      `clud-bug post-inline-threads: \`gh api .../files\` failed (exit ${filesResult.status}): ${(filesResult.stderr || '').slice(0, 500)}\n`,
    );
    process.stdout.write(JSON.stringify({ posted: 0, skipped: [], preexisting: [], error: 'diff-fetch-failed' }) + '\n');
    return;
  }

  let diffFiles = [];
  try {
    // --slurp wraps each page in an outer array; flatten one level.
    const pages = JSON.parse(filesResult.stdout);
    if (Array.isArray(pages)) {
      for (const page of pages) {
        if (Array.isArray(page)) diffFiles.push(...page);
      }
    }
  } catch (e) {
    process.stderr.write(
      `clud-bug post-inline-threads: diff JSON parse failed: ${e.message}\n`,
    );
    process.stdout.write(JSON.stringify({ posted: 0, skipped: [], preexisting: [], error: 'diff-parse-failed' }) + '\n');
    return;
  }

  const plan = planInlineThreads(findings, diffFiles);
  if (plan.comments.length === 0) {
    // Everything fell through to summary-comment fallback (no anchor
    // matches). Not a failure — emit the breakdown so the workflow log
    // explains why no inline threads were posted.
    process.stdout.write(JSON.stringify({
      posted: 0,
      skipped: plan.skipped.map((f) => ({ skill: f.skill, file: f.file, line: f.line, reason: 'not-anchorable' })),
      preexisting: plan.preexisting.map((f) => ({ skill: f.skill })),
      reason: 'no-anchorable-findings',
    }) + '\n');
    return;
  }

  // Post the review. gh accepts the body as a JSON file via --input — we
  // pipe through stdin with `--input -`. Build the body as JSON-on-one-line
  // so stdin is a single write that `gh` reads start-to-finish.
  const reviewBody = JSON.stringify({
    commit_id: headSha,
    event: 'COMMENT',
    body: `Clud-Bug posted ${plan.comments.length} inline finding${plan.comments.length === 1 ? '' : 's'}.`,
    comments: plan.comments,
  });

  const postResult = spawnSync(
    'gh',
    [
      'api',
      '--method', 'POST',
      `repos/${repo}/pulls/${prNumber}/reviews`,
      '--input', '-',
    ],
    { encoding: 'utf8', input: reviewBody },
  );
  if (postResult.status !== 0) {
    process.stderr.write(
      `clud-bug post-inline-threads: \`gh api -X POST .../reviews\` failed (exit ${postResult.status}): ${(postResult.stderr || '').slice(0, 500)}\n`,
    );
    process.stdout.write(JSON.stringify({
      posted: 0,
      skipped: plan.skipped.map((f) => ({ skill: f.skill, file: f.file, line: f.line, reason: 'not-anchorable' })),
      preexisting: plan.preexisting.map((f) => ({ skill: f.skill })),
      error: 'review-post-failed',
    }) + '\n');
    return;
  }

  process.stdout.write(JSON.stringify({
    posted: plan.comments.length,
    skipped: plan.skipped.map((f) => ({ skill: f.skill, file: f.file, line: f.line, reason: 'not-anchorable' })),
    preexisting: plan.preexisting.map((f) => ({ skill: f.skill })),
  }) + '\n');
}


// Wave 5b / 0.7.0-rc.8: D.2.6 auto-resolve on fix-push. Fetches all
// bot-authored unresolved inline threads, asks the Anthropic Messages
// API per-thread whether the new commit addressed the original
// finding, and resolves ADDRESSED threads (with a marker reply) while
// leaving UNCERTAIN/NOT_ADDRESSED open. Fail-closed throughout —
// verifier errors route to UNCERTAIN; the surrounding workflow
// step's `continue-on-error: true` is the single failure gate.
//
// Required env: GH_TOKEN, ANTHROPIC_API_KEY, REPO ("owner/name"), PR_NUMBER.
//
// No `--stdin` — fetches everything from `gh api graphql` itself.
// Workflow gates this verb on `github.event.action == 'synchronize'`
// so it only runs on fix-pushes (not initial PR opens, when there
// are no prior threads to resolve).
async function runResolveThreads(_args) {
  const {
    parseThreadBody,
    extractAnchorContext,
    REVIEW_THREADS_QUERY,
    RESOLVE_THREAD_MUTATION,
    ADD_REPLY_MUTATION,
  } = await import('../core/inline-threads.js');
  const {
    readAutoResolveConfigFromCludBug,
    runAutoResolve,
    applyResolutionRules,
    selectResolveAuth,
    renderResolveMarkerTag,
    anchorSignature,
    latestResolveMarker,
  } = await import('../core/auto-resolve.js');
  const {
    VERIFIER_SYSTEM,
    buildVerifierPrompt,
    parseVerifierResponse,
  } = await import('../core/resolve-verifier.js');

  // ---- Env validation ----------------------------------------------------
  const repo = String(process.env.REPO ?? '').trim();
  const prNumberRaw = String(process.env.PR_NUMBER ?? '').trim();
  const prNumber = Number(prNumberRaw);
  const ghToken = String(process.env.GH_TOKEN ?? '').trim();
  const anthropicKey = String(process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (!repo || !repo.includes('/') || !Number.isInteger(prNumber) || prNumber <= 0 || !ghToken || !anthropicKey) {
    process.stderr.write(
      `clud-bug resolve-threads: REPO + PR_NUMBER + GH_TOKEN + ANTHROPIC_API_KEY env vars required.\n`,
    );
    process.stdout.write(JSON.stringify({ actions: [], verifierCallCount: 0, shouldRequestChanges: false, error: 'missing-env' }) + '\n');
    return;
  }
  const [owner, repoName] = repo.split('/', 2);

  // ---- Optional .clud-bug.json config (autoResolve block) ----------------
  // The workflow's working dir is the PR checkout — if .clud-bug.json is
  // present we read autoResolve from it. Otherwise defaults (mode='verified').
  let autoResolveConfig;
  try {
    const cfgPath = join(process.cwd(), '.claude/skills/.clud-bug.json');
    const cfgRaw = await readFile(cfgPath, 'utf8');
    const cfg = JSON.parse(cfgRaw);
    autoResolveConfig = readAutoResolveConfigFromCludBug(cfg, (msg) => {
      process.stderr.write(`clud-bug resolve-threads: config warning: ${msg}\n`);
    });
  } catch (err) {
    // Missing OR unparseable .clud-bug.json — use defaults but log the
    // specific reason so an operator with malformed config can diagnose
    // why their `autoResolve.mode = 'off'` is being silently ignored.
    const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined;
    if (code !== 'ENOENT') {
      process.stderr.write(
        `clud-bug resolve-threads: .clud-bug.json read/parse error (${err && typeof err === 'object' && 'message' in err ? err.message : String(err)}); using defaults.\n`,
      );
    }
    autoResolveConfig = readAutoResolveConfigFromCludBug(null);
  }

  if (autoResolveConfig.mode === 'off') {
    process.stdout.write(JSON.stringify({ actions: [], verifierCallCount: 0, shouldRequestChanges: false, reason: 'mode-off' }) + '\n');
    return;
  }

  // ---- Fetch threads via GraphQL -----------------------------------------
  // `gh api graphql` uses `-f` for String! variables and `-F` for typed
  // (number / bool) variables. Owner + repo are String! per the query;
  // pr is Int!. Reviewer-flagged: passing owner/repo as `-F` would coerce
  // numeric-looking values incorrectly.
  const threadsResult = spawnSync(
    'gh',
    [
      'api', 'graphql',
      '-f', `query=${REVIEW_THREADS_QUERY}`,
      '-f', `owner=${owner}`,
      '-f', `repo=${repoName}`,
      '-F', `pr=${prNumber}`,
    ],
    { encoding: 'utf8' },
  );
  if (threadsResult.status !== 0) {
    process.stderr.write(`clud-bug resolve-threads: gh api graphql (threads) failed (exit ${threadsResult.status}): ${(threadsResult.stderr || '').slice(0, 500)}\n`);
    process.stdout.write(JSON.stringify({ actions: [], verifierCallCount: 0, shouldRequestChanges: false, error: 'threads-fetch-failed' }) + '\n');
    return;
  }

  let threadNodes;
  try {
    const parsed = JSON.parse(threadsResult.stdout);
    threadNodes = parsed?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
    if (!Array.isArray(threadNodes)) threadNodes = [];
  } catch (e) {
    process.stderr.write(`clud-bug resolve-threads: threads JSON parse failed: ${e.message}\n`);
    process.stdout.write(JSON.stringify({ actions: [], verifierCallCount: 0, shouldRequestChanges: false, error: 'threads-parse-failed' }) + '\n');
    return;
  }

  // ---- Filter to bot-authored unresolved threads with our marker --------
  // The workflow's GITHUB_TOKEN posts as `github-actions[bot]`. Match both
  // the bracketed bot form and the bare `github-actions` form (GraphQL
  // can return either depending on the node-type field requested).
  const BOT_AUTHORS = new Set(['github-actions', 'github-actions[bot]']);
  const candidates = [];
  for (const t of threadNodes) {
    if (!t || t.isResolved) continue;
    const c = t.comments?.nodes?.[0];
    if (!c) continue;
    const authorLogin = c.author?.login ?? '';
    if (!BOT_AUTHORS.has(authorLogin)) continue;
    const parsed = parseThreadBody(c.body ?? '');
    if (!parsed) continue;
    if (!c.path || (c.line === null && c.originalLine === null)) continue;
    candidates.push({
      threadId: t.id,
      file: c.path,
      line: c.line ?? c.originalLine,
      parsed,
      // Wave 5b.1: full comment list so idempotency can spot a prior
      // bot reply's resolve marker (verdict + anchor sig) on this thread.
      comments: t.comments?.nodes ?? [],
    });
  }

  if (candidates.length === 0) {
    process.stdout.write(JSON.stringify({ actions: [], verifierCallCount: 0, shouldRequestChanges: false, reason: 'no-bot-threads' }) + '\n');
    return;
  }

  // ---- Fetch diff for anchor context -------------------------------------
  const filesResult = spawnSync(
    'gh',
    [
      'api',
      `repos/${repo}/pulls/${prNumber}/files`,
      '--paginate',
      '--slurp',
    ],
    { encoding: 'utf8' },
  );
  if (filesResult.status !== 0) {
    process.stderr.write(`clud-bug resolve-threads: diff fetch failed (exit ${filesResult.status}): ${(filesResult.stderr || '').slice(0, 500)}\n`);
    process.stdout.write(JSON.stringify({ actions: [], verifierCallCount: 0, shouldRequestChanges: false, error: 'diff-fetch-failed' }) + '\n');
    return;
  }
  let diffFiles = [];
  try {
    const pages = JSON.parse(filesResult.stdout);
    if (Array.isArray(pages)) {
      for (const page of pages) {
        if (Array.isArray(page)) diffFiles.push(...page);
      }
    }
  } catch (e) {
    process.stderr.write(`clud-bug resolve-threads: diff JSON parse failed: ${e.message}\n`);
    process.stdout.write(JSON.stringify({ actions: [], verifierCallCount: 0, shouldRequestChanges: false, error: 'diff-parse-failed' }) + '\n');
    return;
  }

  // ---- Build PriorThread[] for runAutoResolve ----------------------------
  const priorThreads = candidates.map((c) => {
    const ctx = extractAnchorContext({ file: c.file, line: c.line }, diffFiles);
    const findingBody = c.parsed.reasoning
      ? `${c.parsed.summary}\n\n${c.parsed.reasoning}`
      : c.parsed.summary;
    return {
      threadId: c.threadId,
      finding: {
        severity: c.parsed.severity,
        body: findingBody,
        skill: c.parsed.skill,
        file: c.file,
        line: c.line,
      },
      codeBefore: ctx.codeBefore,
      codeAfter: ctx.codeAfter,
      ...(ctx.diffAtAnchor !== undefined ? { diffAtAnchor: ctx.diffAtAnchor } : {}),
    };
  });

  // ---- Define verifier (Anthropic Messages API via raw fetch) -----------
  // Model is hardcoded here — the verifier needs a model that handles
  // structured JSON output reliably. Sonnet 4.6 is the default. Override
  // via CLUD_BUG_VERIFIER_MODEL env var if needed.
  const verifierModel = String(process.env.CLUD_BUG_VERIFIER_MODEL ?? '').trim()
    || 'claude-sonnet-4-6';

  async function verifier(input) {
    const userPrompt = buildVerifierPrompt(input);
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': anthropicKey,
        },
        body: JSON.stringify({
          model: verifierModel,
          max_tokens: 300,
          system: VERIFIER_SYSTEM,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return {
          verdict: 'UNCERTAIN',
          source: 'api-error',
          rationale: `Anthropic API ${resp.status}: ${errText.slice(0, 200)}`,
        };
      }
      const body = await resp.json();
      // Messages API: content is an array of blocks; pick the first text block.
      const text = (body?.content ?? []).find((b) => b?.type === 'text')?.text ?? '';
      return parseVerifierResponse(text);
    } catch (err) {
      return {
        verdict: 'UNCERTAIN',
        source: 'api-error',
        rationale: `verifier fetch error: ${err?.message ?? String(err)}`,
      };
    }
  }

  // ---- Resolve auth (Wave 5b.1: PAT optional + graceful fallback) -------
  // A dedicated PAT lets us actually close threads; without one the Actions
  // GITHUB_TOKEN can't resolve, so we post a "verified fixed" reply only.
  const auth = selectResolveAuth(process.env);

  // ---- Idempotency: skip threads whose anchor is unchanged --------------
  // For each candidate, hash the post-fix anchor and look for a prior bot
  // reply carrying the same (verdict, sig) marker. If the anchor hasn't moved
  // since that marker, we re-use the cached verdict — NO verifier call, NO
  // re-post — which kills repeat replies on multi-push PRs and saves spend.
  const verifyItems = []; // { thread, sig } — need (re)verification
  const cachedItems = []; // { thread, action } — anchor unchanged, no I/O
  for (let i = 0; i < priorThreads.length; i++) {
    const thread = priorThreads[i];
    const candidate = candidates[i];
    if (!thread) continue;
    const sig = anchorSignature(thread.finding, thread.codeAfter);
    const prior = latestResolveMarker(candidate?.comments ?? [], BOT_AUTHORS);
    if (prior && prior.sig === sig) {
      const action = applyResolutionRules({
        thread,
        verdict: {
          verdict: prior.verdict,
          source: 'model',
          rationale: '(unchanged since last check)',
        },
        config: autoResolveConfig,
        canResolve: auth.hasDedicatedPat,
      });
      cachedItems.push({ thread, action });
    } else {
      verifyItems.push({ thread, sig });
    }
  }

  // ---- Run pure orchestration on the threads that need (re)verification --
  const result = await runAutoResolve({
    priorThreads: verifyItems.map((v) => v.thread),
    config: autoResolveConfig,
    verifier,
    canResolve: auth.hasDedicatedPat,
  });

  let shouldRequestChanges = result.shouldRequestChanges;
  for (const c of cachedItems) {
    if (c.action.kind === 'keep_open_request_changes') shouldRequestChanges = true;
  }

  // ---- Execute the actions via GraphQL mutations ------------------------
  const actionsReport = [];

  // Unchanged threads: never re-post the reply (idempotent). BUT if the
  // thread is verified ADDRESSED and a PAT is now available, resolve it —
  // the marker reply already exists, so this closes a thread that couldn't
  // be resolved before (no-PAT → PAT upgrade, or a prior transient
  // resolve-failure) WITHOUT re-verifying or re-replying.
  for (const c of cachedItems) {
    const baseReport = {
      threadId: c.thread.threadId,
      file: c.thread.finding.file,
      line: c.thread.finding.line,
      verdict: c.action.verdict?.verdict,
      kind: c.action.kind,
    };
    if (c.action.kind === 'resolve' && auth.hasDedicatedPat) {
      const resolveResult = spawnSync(
        'gh',
        [
          'api', 'graphql',
          '-f', `query=${RESOLVE_THREAD_MUTATION}`,
          '-f', `threadId=${c.thread.threadId}`,
        ],
        { encoding: 'utf8', env: { ...process.env, GH_TOKEN: auth.token } },
      );
      if (resolveResult.status !== 0) {
        process.stderr.write(`clud-bug resolve-threads: RESOLVE (cached) failed for thread ${c.thread.threadId}: ${(resolveResult.stderr || '').slice(0, 200)}\n`);
        actionsReport.push({ ...baseReport, executed: 'resolve-failed' });
      } else {
        actionsReport.push({ ...baseReport, executed: 'resolved-from-cache' });
      }
    } else {
      actionsReport.push({ ...baseReport, executed: 'unchanged' });
    }
  }

  for (let i = 0; i < result.actions.length; i++) {
    const action = result.actions[i];
    const item = verifyItems[i];
    if (!action || !item) continue;
    const thread = item.thread;
    const report = {
      threadId: thread.threadId,
      file: thread.finding.file,
      line: thread.finding.line,
      verdict: action.verdict?.verdict,
      kind: action.kind,
    };

    if (action.kind === 'skipped') {
      actionsReport.push({ ...report, executed: 'skipped' });
      continue;
    }

    // Reply body carries a hidden idempotency marker (verdict + anchor sig)
    // so a later fix-push won't re-reply while the anchor is unchanged.
    const tag = renderResolveMarkerTag(action.verdict.verdict, item.sig);
    const replyBody = `${action.markerBody}\n\n${tag}`;
    const replyResult = spawnSync(
      'gh',
      [
        'api', 'graphql',
        '-f', `query=${ADD_REPLY_MUTATION}`,
        '-f', `threadId=${thread.threadId}`,
        '-f', `body=${replyBody}`,
      ],
      { encoding: 'utf8' },
    );
    if (replyResult.status !== 0) {
      process.stderr.write(`clud-bug resolve-threads: ADD_REPLY failed for thread ${thread.threadId}: ${(replyResult.stderr || '').slice(0, 200)}\n`);
      actionsReport.push({ ...report, executed: 'reply-failed' });
      continue;
    }

    // Resolve only ADDRESSED threads, and only with a dedicated PAT — the
    // Actions GITHUB_TOKEN can't resolve ("Resource not accessible by
    // integration"). No PAT → marker-reply-only (graceful, no error).
    if (action.kind === 'resolve') {
      if (!auth.hasDedicatedPat) {
        actionsReport.push({ ...report, executed: 'reply-only-no-pat' });
        continue;
      }
      const resolveResult = spawnSync(
        'gh',
        [
          'api', 'graphql',
          '-f', `query=${RESOLVE_THREAD_MUTATION}`,
          '-f', `threadId=${thread.threadId}`,
        ],
        // Scope the PAT to JUST this call; all other gh calls keep GH_TOKEN.
        { encoding: 'utf8', env: { ...process.env, GH_TOKEN: auth.token } },
      );
      if (resolveResult.status !== 0) {
        process.stderr.write(`clud-bug resolve-threads: RESOLVE failed for thread ${thread.threadId}: ${(resolveResult.stderr || '').slice(0, 200)}\n`);
        actionsReport.push({ ...report, executed: 'resolve-failed' });
        continue;
      }
      actionsReport.push({ ...report, executed: 'resolved' });
    } else {
      // keep_open or keep_open_request_changes — reply already posted.
      actionsReport.push({ ...report, executed: 'kept-open' });
    }
  }

  process.stdout.write(JSON.stringify({
    actions: actionsReport,
    verifierCallCount: result.verifierCallCount,
    shouldRequestChanges,
    resolveTokenSource: auth.source,
  }) + '\n');
}


// 0.0.E (v0.6.17): thin wrapper around the golden-set test file. Devs
// who follow the README invoke `clud-bug eval` — this routes to the
// same `node --test` runner CI uses, so dev and CI verdicts match.
//
// Dev-only: runs against the prompt bundled in PKG_ROOT (the cloned
// clud-bug repo). `test/` is intentionally not in package.json `files`,
// so invoking this from a globally installed copy will ENOENT. No args
// supported yet — the README does not advertise any.
async function runEval() {
  const result = spawnSync(
    'node',
    ['--test', join(PKG_ROOT, 'test/prompts.eval.test.js')],
    { stdio: 'inherit' },
  );
  process.exit(result.status ?? 1);
}

async function runInit(args) {
  const cwd = process.cwd();
  log(`🐛 Field season opens in ${cwd}.`);

  log('  surveying habitat...');
  const signals = await detect(cwd);
  log(`    primary language: ${signals.primaryLanguage || '(unknown)'}`);
  log(`    search terms:     ${signals.searchTerms.join(', ') || '(none)'}`);

  const baseline = await loadBaseline(BASELINE_DIR);
  const fromAgentSkills = baseline.filter((s) => s._source === 'agent-skills').length;
  const sourceLabel = baseline.length === 0
    ? ''
    : fromAgentSkills === baseline.length ? ' (from thrillmade/agent-skills)'
    : fromAgentSkills === 0               ? ' (bundled fallback)'
                                          : ` (${fromAgentSkills} from agent-skills, ${baseline.length - fromAgentSkills} bundled)`;
  log(`    baseline kit:     ${baseline.length} specimens${sourceLabel}`);

  let curated = [];
  let searched = [];
  if (args.offline) {
    log('  --offline: skipping skills.sh');
  } else {
    const client = new SkillsClient();
    try {
      log('  consulting skills.sh...');
      [curated, searched] = await Promise.all([
        client.curated().catch(err => { warn(`curated query failed: ${err.message}`); return []; }),
        client.search(signals.searchTerms).catch(err => { warn(`search failed: ${err.message}`); return []; }),
      ]);
      log(`    curated: ${curated.length}, search hits: ${searched.length}`);
    } catch (err) {
      warn(`skills.sh unreachable (${err.message}); continuing with baseline only`);
    }
  }

  const recommended = rankAndCap(curated, searched, baseline);
  log('');
  log('Specimens to pin:');
  for (const s of recommended) {
    const tag = s.kind === 'baseline' ? '[baseline]' : `[${s.source}]`;
    log(`  • ${s.name} ${tag}`);
    if (s.description && s.kind !== 'baseline') log(`      ${s.description}`);
  }
  log('');

  let chosen = recommended;
  if (!args.acceptAll && recommended.some(s => s.kind !== 'baseline')) {
    chosen = await promptForSkills(recommended);
  }

  log('  pinning specimens to .claude/skills/...');
  const client = new SkillsClient();
  const written = await writeSkills(join(cwd, '.claude', 'skills'), chosen, client);
  log(`    pinned ${written.length} specimens`);

  // Empty-skills warning: clud-bug shines when paired with project-specific
  // skills. Reviews that load only the three baselines are functional but
  // generic; flag this so users notice.
  const remoteCount = written.filter((w) => w.kind !== 'baseline').length;
  if (remoteCount === 0) {
    warn('Only baseline specimens pinned. Add project-specific skills via `clud-bug add vercel-labs/skills/<name>` or drop your own `.claude/skills/<name>/SKILL.md`.');
  }

  log('  drafting field kit...');
  const tmplName = pickTemplate(signals.languages);
  const tmplPath = join(TEMPLATES, tmplName);
  // REVIEW_SCHEMA + CCA_VERSION + CLUD_BUG_VERSION come from render.js DEFAULTS.
  const workflow = await renderFile(tmplPath, {
    REVIEW_PROMPT: reviewPrompt({
      projectDescription: buildDescriptionLine(signals),
      language: templateLanguage(tmplName),
    }),
  });
  // --local-only (max mode): SKIP the GitHub Action workflows entirely. The
  // review + audit workflows run `claude-code-action` with ANTHROPIC_API_KEY
  // (per-token cost); max mode reviews on the session's own subscription, so a
  // local-only install must never add a token-billing Action. (self-update is
  // benign but skipped too — local-only means no clud-bug CI workflows at all.)
  if (args.localOnly) {
    log('    skipped GitHub Action workflows (--local-only: max mode runs on the session subscription, no API key)');
  } else {
    const workflowPath = join(cwd, '.github', 'workflows', 'clud-bug-review.yml');
    await mkdir(dirname(workflowPath), { recursive: true });
    await writeFile(workflowPath, workflow);
    log(`    wrote ${rel(cwd, workflowPath)}`);

    // Install the audit workflow alongside the per-PR review one.
    // Manual-trigger by default; users opt into the cron by uncommenting.
    // Routed through renderFile so {{CCA_VERSION}} substitution pins
    // claude-code-action consistently with the review workflow.
    const auditTmpl = await renderFile(join(TEMPLATES, 'audit.yml.tmpl'), {});
    const auditPath = join(cwd, '.github', 'workflows', 'clud-bug-audit.yml');
    await writeFile(auditPath, auditTmpl);
    log(`    wrote ${rel(cwd, auditPath)}`);

    // Install the self-update workflow. Cron weekly Mondays 12:00 UTC; opens
    // a PR if a newer clud-bug version is published. Disable by deleting the
    // file or pinning via .claude/skills/.clud-bug.json.
    // Routed through renderFile for parity (no CCA ref today but future
    // tokens should propagate uniformly).
    const selfUpdateTmpl = await renderFile(join(TEMPLATES, 'self-update.yml.tmpl'), {});
    const selfUpdatePath = join(cwd, '.github', 'workflows', 'clud-bug-self-update.yml');
    await writeFile(selfUpdatePath, selfUpdateTmpl);
    log(`    wrote ${rel(cwd, selfUpdatePath)}`);

    // Install the fork-notice workflow. SPEC §6.5: a fork pull request gets a
    // NEUTRAL `clud-bug-review` check plus a comment saying nothing was
    // reviewed. The review workflow physically cannot do either — GitHub gives
    // it a read-only token on fork PRs, and a job conclusion has no `neutral`.
    // `pull_request_target` is the one trigger that runs with the base repo's
    // writable token, so this tiny workflow (no checkout, no secrets, no head
    // code) owns the fork case. See templates/fork-notice.yml.tmpl's header.
    const forkNoticeTmpl = await renderFile(join(TEMPLATES, 'fork-notice.yml.tmpl'), {});
    const forkNoticePath = join(cwd, '.github', 'workflows', 'clud-bug-fork-notice.yml');
    await writeFile(forkNoticePath, forkNoticeTmpl);
    log(`    wrote ${rel(cwd, forkNoticePath)}`);
  }

  // v0.7.0 (Wave 6b): optional local-review slash command. Scaffolds
  // `.claude/commands/clud-bug-review.md` so `/clud-bug-review` works inside a
  // Claude Code session — the agent reviews the current branch's open PR using
  // THAT session's own tokens (Max or API), no hosted App or new auth required.
  // `.claude/` is already in the --commit add-list below, so it's staged too.
  // `--with-hooks` implies `--with-local-review` — the auto hook and the manual
  // `/clud-bug-review` command are complementary (the hook auto-runs the engine
  // recipe on each commit; the command runs it on demand against the PR).
  // --local-only IS the max-mode install: the slash command + the commit hook,
  // minus the GitHub Action workflows (gated above).
  if (args.localOnly) {
    args.withLocalReview = true;
    args.withHooks = true;
  }
  if (args.withHooks) args.withLocalReview = true;
  if (args.withLocalReview) {
    const commandPath = join(cwd, '.claude', 'commands', 'clud-bug-review.md');
    await mkdir(dirname(commandPath), { recursive: true });
    const commandContent = await renderFile(join(TEMPLATES, 'clud-bug-review.md.tmpl'), {});
    await writeFile(commandPath, commandContent);
    log(`    wrote ${rel(cwd, commandPath)}`);
  }

  // v0.7.0 (Wave 6b; rc.17 fix): optional native commit-review hook. Merges a
  // Claude Code `type: command` PostToolUse hook into `.claude/settings.json`
  // (preserving any existing settings + hooks) that, on every `git commit`, runs
  // `clud-bug review-prompt` and surfaces the recipe back to the session so the
  // agent reviews the commit on the session's subscription, in the background.
  // (`type: command`, not `type: agent` — agent hooks get no Bash, so they could
  // never run the CLI; see hooks.ts.)
  // #276 — resolve WHICH local-review surface to install. SPEC 2.0 §4.1:
  // "Where it is enabled, the repository chooses when: after a commit, or
  // before a push. A reviewer MUST support both, and push is the default,
  // because a commit often catches work half-done and reports defects the next
  // commit was going to fix anyway."
  //
  // OPT-IN vs DEFAULT-ON, which are different questions and the SPEC answers
  // them differently. The local review as a whole is OPT-IN — §4.1: "A review
  // MAY also run locally, before a pull request exists, and a repository opts
  // into that. It is off unless asked for". So `--no-hooks` still installs
  // nothing. The TRIGGER, once opted in, defaults to push.
  const hookTrigger = (() => {
    const raw = args.hookTrigger === null || args.hookTrigger === undefined ? 'push' : String(args.hookTrigger);
    if (raw === 'push' || raw === 'commit' || raw === 'both') return raw;
    warn(`Unrecognized --hook-trigger "${raw}" (expected push|commit|both); using push.`);
    return 'push';
  })();
  const wantsCommitHook = args.withHooks && (hookTrigger === 'commit' || hookTrigger === 'both');
  const wantsPrePushHook = args.withHooks && (hookTrigger === 'push' || hookTrigger === 'both');

  if (wantsCommitHook) {
    const { mergeLocalReviewHook, buildCommitReviewCommand } = await import('./hooks.js');
    // Floating @next pin (default) — the hook auto-fetches the latest recipe.
    const hookCommand = buildCommitReviewCommand();
    const settingsPath = join(cwd, '.claude', 'settings.json');
    await mkdir(dirname(settingsPath), { recursive: true });
    // Read-then-parse so we can tell "no file yet" (fresh merge) from "file
    // exists but is invalid JSON" (leave it ALONE — never clobber user content).
    let raw: string | undefined;
    try {
      raw = await readFile(settingsPath, 'utf8');
    } catch {
      raw = undefined; // no settings.json yet → fresh
    }
    let existing: unknown;
    let proceed = true;
    if (raw !== undefined) {
      try {
        existing = JSON.parse(raw);
      } catch {
        proceed = false;
        log(`    skipped ${rel(cwd, settingsPath)} (existing file is not valid JSON; left untouched)`);
      }
    }
    if (proceed) {
      const merged = mergeLocalReviewHook(existing, hookCommand);
      await writeFile(settingsPath, JSON.stringify(merged, null, 2) + '\n');
      log(`    wrote ${rel(cwd, settingsPath)} (commit-review hook)`);
    }

    // #240 vector 3 — seed the worktree-local HEAD-moved baseline NOW, at
    // install time, so an `init` immediately followed by a commit in the
    // SAME session still fires (the hook's cold-start behavior is to seed
    // silently and NOT fire on its very first invocation, since it can't
    // otherwise tell "HEAD predates the hook" from "HEAD was just
    // committed" — see hooks.ts). Best-effort; never fails `init`.
    try {
      const gitDirResult = spawnSync('git', ['rev-parse', '--git-dir'], { cwd, encoding: 'utf8' });
      const headResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
      if (gitDirResult.status === 0 && headResult.status === 0) {
        const gitDir = gitDirResult.stdout.trim();
        const head = headResult.stdout.trim();
        if (gitDir && head) {
          await writeFile(join(cwd, gitDir, 'clud-bug-last-seen-head'), head);
        }
      }
    } catch {
      // best-effort — a missing/non-git cwd just means the cold-start
      // window stays open for one extra commit; never fails init.
    }
  }

  // #276 — the pre-push surface (SPEC 2.0 §6.7: "Git allows one `pre-push`
  // hook, so ownership follows what is installed"). Writes the script into
  // `git rev-parse --git-path hooks` (which honours core.hooksPath, and in a
  // linked worktree resolves to the shared common dir, so one install covers
  // every worktree of the repo).
  //
  // NOTE this is NOT committed and cannot be: git hooks live outside the work
  // tree, so every clone runs `clud-bug init` (or `clud-bug update`) to get it.
  // That is inherent to `pre-push`, not a choice made here.
  if (wantsPrePushHook) {
    await installPrePushHook(cwd);
  }

  // rc.16: --with-design installs the bundled design-critic kit (4 `kind:
  // design` skills) and enables the off-by-default design lens. writeSkills
  // writes the SKILL.md files + merges the manifest entries; the `design` block
  // is flipped on the manifest read below so the local recipe + hosted bot both
  // run the visual pass. Idempotent — re-runs replace the skills in place.
  if (args.withDesign) {
    const designKit = await loadDesignKit(DESIGN_DIR);
    if (designKit.length > 0) {
      await writeSkills(join(cwd, '.claude', 'skills'), designKit, client);
      log(`    pinned ${designKit.length} design specimens (visual review lens enabled)`);
    } else {
      warn('No design-kit skills found to install (templates/skills/design/ empty?).');
    }
  }

  // Stamp the manifest. Sets strictMode: true ONLY on fresh installs —
  // a manifest that's never been touched by clud-bug init/update has no
  // lastUpdate field. Existing v0.3.x advisory installs (where strictMode
  // was never written and so == undefined) keep their advisory behavior
  // because lastUpdate IS set; the strictMode default only fires on truly
  // fresh inits. Users opt out by setting strictMode: false.
  const skillsDirPath = join(cwd, '.claude', 'skills');
  const manifest = await readManifest(skillsDirPath);
  if (args.withDesign) {
    // Flip the off-by-default design lens on; preserve any existing knobs
    // (gate / themes / viewports) the user already set.
    const prior = (manifest.design as Record<string, unknown> | undefined) ?? {};
    manifest.design = { ...prior, enabled: true };
  }
  const isFreshInstall = manifest.lastUpdate === undefined;
  manifest.lastUpdateVersion = await readPkgVersion();
  manifest.lastUpdate = new Date().toISOString();
  if (isFreshInstall && manifest.strictMode === undefined) {
    manifest.strictMode = true;
  }
  await writeManifest(skillsDirPath, manifest);

  // Tell other agents what's installed and how to coexist with the bot.
  // Idempotent — re-runs replace the prior block in place. AGENTS.md is the
  // canonical home (cross-tool); CLAUDE.md / GEMINI.md / Cursor / Windsurf
  // / Cline / Continue rules files get the same block appended IF they
  // already exist (we don't proliferate stubs the user didn't ask for).
  log('  briefing other agents (AGENTS.md / CLAUDE.md)...');
  // Pass `=== true` (not `!== false`) so the rendered block matches the
  // workflow's gate predicate exactly. A v0.3 advisory upgrade where
  // strictMode is undefined renders "off" — which is what the workflow
  // actually does on that manifest.
  const agentDocs = await applyAgentDocs(cwd, {
    version: manifest.lastUpdateVersion,
    strictMode: manifest.strictMode === true,
  });
  for (const p of agentDocs.created) log(`    created ${p}`);
  for (const p of agentDocs.touched) log(`    updated ${p}`);

  if (args.commit) {
    log('  committing...');
    const toAdd = [
      '.claude',
      // No GitHub Action workflows under --local-only (none were written).
      ...(args.localOnly
        ? []
        : [
            '.github/workflows/clud-bug-review.yml',
            '.github/workflows/clud-bug-audit.yml',
            '.github/workflows/clud-bug-self-update.yml',
            '.github/workflows/clud-bug-fork-notice.yml',
          ]),
      ...agentDocs.created,
      ...agentDocs.touched,
    ];
    spawnSync('git', ['add', ...toAdd], { cwd, stdio: 'inherit' });
    spawnSync('git', ['commit', '-m', 'Add clud-bug 🐛 — a field guide to specimens crawling your code'], { cwd, stdio: 'inherit' });
  }

  // Offer to enable required_conversation_resolution on the default
  // branch. clud-bug auto-resolves its own review threads when fixes
  // land — without this setting, that doesn't gate merges. Skipped on
  // --no-set-protection for repos that manage protection via ruleset
  // or org policy.
  await runInitBranchProtection(args);

  log('');
  log('Field kit assembled. Next:');
  // #276 — describe the surface that was ACTUALLY installed. Saying "on every
  // commit" when a pre-push hook was written is the kind of claim this project
  // treats as a defect, not a wording nit.
  const localSurfaceLine =
    wantsCommitHook && wantsPrePushHook
      ? 'both the pre-push hook and the commit-review hook'
      : wantsPrePushHook
        ? 'a git pre-push hook (SPEC §4.1 makes push the default trigger)'
        : 'the commit-review hook';
  if (args.localOnly) {
    log('  Max mode — reviews run inside your Claude Code session on your own');
    log('  subscription. No API key, no GitHub Action, no per-review bill.');
    log(`  Installed: ${localSurfaceLine}; or run /clud-bug-review on demand.`);
    if (wantsPrePushHook) {
      log('  The pre-push hook lives in .git/hooks — it is NOT committed, so every');
      log('  fresh clone needs `clud-bug init` (or `clud-bug update`) again.');
    }
    if (!args.commit) {
      log('  → git add .claude && git commit && git push');
    } else {
      log('  → git push.');
    }
  } else {
    if (args.withHooks) {
      log(`  Both review surfaces installed: the local one (${localSurfaceLine}, on your`);
      log('  Claude Code session) AND the GitHub Action enforcer (gates the merge on');
      log('  CI). Pass --no-hooks to install only the Action, or --hook-trigger to');
      log('  choose push (default) / commit / both.');
    } else {
      log('  GitHub Action enforcer installed (--no-hooks: no local review hook).');
    }
    log('  1. Set ANTHROPIC_API_KEY in your repo secrets:');
    log('     Settings → Secrets and variables → Actions → New repository secret');
    if (!args.commit) {
      log('  2. git add .claude .github/workflows/clud-bug-*.yml && git commit && git push');
      log('  3. Open a PR — the naturalist arrives within ~2 minutes.');
    } else {
      log('  2. git push, then open a PR — the naturalist arrives within ~2 minutes.');
    }
  }
  log('');
  log('Drop your own .claude/skills/<name>/SKILL.md files anytime — they get pinned automatically.');
  // These reference the GitHub Action workflows, which --local-only does not write.
  if (!args.localOnly) {
    log('For a whole-repo walk: Actions tab → Clud Bug 🐛 Audit → Run workflow.');
    log('Self-update is on (weekly Mondays 12:00 UTC). Pin via "pinVersion" in .claude/skills/.clud-bug.json.');
  }
  log('');
  if (args.localOnly) {
    log('Strict mode + branch-protection enforcement apply to the GitHub Action path; max mode is');
    log('advisory by design — findings surface in your session for you to act on.');
  } else {
    log('Strict mode is ON by default (clud-bug-review fails the check on critical findings).');
    log('  • Add `clud-bug-review` to your branch protection required checks for full enforcement.');
  }
  log('  • Opt out by setting "strictMode": false in .claude/skills/.clud-bug.json.');

  // Phase M — a quiet, on-voice support nudge for the free tiers (max mode +
  // self-hosted Action run on the user's own resources; no metered charge fits).
  // The GitHub "Sponsor" button + the Stripe "coffee" link both live in FUNDING.yml.
  log('');
  log('clud-bug forages on your own subscription — free, and meant to stay that way.');
  log('If the specimens earn their keep, you can feed the bug: github.com/sponsors/thrillmade');

  // v0.6.33 — opt-in unified install (mirror of logmind v0.6.8). When
  // --with-skdd is passed, subprocess to `pip install logmind` + `logmind init`
  // so Node-first users get the same one-command bootstrap as Python-first
  // users do via `logmind init --with-skdd`.
  // ANTI-LOOP: invoke `logmind init` (NOT `logmind init --with-skdd`).
  // Each opt-in flag only goes one level — no mutual recursion possible.
  if (args.withSkdd) {
    await installLogmindViaPip();
  }

  // Final agent-friendly summary line (always emitted, even with --quiet).
  const version = await readPkgVersion();
  ok(`initialized: .claude/skills/ ${chosen.length} specimens, workflow @v${version}`);
}

async function installLogmindViaPip() {
  // `spawn` is already imported at module top (line 5). No dynamic
  // re-import needed.
  //
  // Warnings use process.stderr.write directly (always emitted, even
  // under CLUD_BUG_QUIET=1) — recovery hints MUST surface to the user.
  // The standard `log()` is for progress chatter which quiet suppresses.

  // Find pip via fallback chain (pip → pip3 → python -m pip).
  const pipCmd = await findPipCommand();
  if (!pipCmd) {
    process.stderr.write(
      '\nWarning: --with-skdd requested but no `pip`/`pip3`/`python` found on PATH.\n' +
      '  Install Python 3.10+ (https://python.org), then run:\n' +
      '    pip install logmind && logmind init\n' +
      '  Or skip this flag if you only want clud-bug standalone.\n'
    );
    return;
  }

  log('');
  log(`→ --with-skdd: installing logmind (${pipCmd.join(' ')} install logmind)`);

  const installCode = await new Promise((resolve) => {
    const child = spawn(pipCmd[0], [...pipCmd.slice(1), 'install', 'logmind'], { stdio: 'inherit' });
    child.on('error', () => resolve(127));
    child.on('close', (code) => resolve(code ?? 1));
  });
  if (installCode !== 0) {
    process.stderr.write(
      `Warning: \`pip install logmind\` exited ${installCode}.\n` +
      '  clud-bug side succeeded; logmind install is incomplete.\n' +
      '  Inspect output above and re-run manually if needed.\n'
    );
    return;
  }

  log(`→ --with-skdd: running \`logmind init\` to scaffold the logmind side`);
  const initCode = await new Promise((resolve) => {
    const child = spawn('logmind', ['init'], { stdio: 'inherit' });
    child.on('error', () => resolve(127));
    child.on('close', (code) => resolve(code ?? 1));
  });
  if (initCode !== 0) {
    process.stderr.write(
      `Warning: \`logmind init\` exited ${initCode}. logmind install completed `
      + `but init scaffolding is incomplete. Re-run manually to finish.\n`
    );
    return;
  }
  log('✓ logmind installed via --with-skdd');
}

async function findPipCommand() {
  // Try pip → pip3 → python -m pip → python3 -m pip in order. First one
  // that responds to --version wins. Returns array form for spawn().
  // `spawn` is already imported at module top.
  const candidates = [
    ['pip'],
    ['pip3'],
    ['python', '-m', 'pip'],
    ['python3', '-m', 'pip'],
  ];
  for (const cmd of candidates) {
    const ok = await new Promise((resolve) => {
      const child = spawn(cmd[0], [...cmd.slice(1), '--version'], { stdio: ['ignore', 'ignore', 'ignore'] });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });
    if (ok) return cmd;
  }
  return null;
}

async function promptForSkills(recommended) {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question('Install all of the above? [Y/n/select] ');
    const a = answer.trim().toLowerCase();
    if (a === '' || a === 'y' || a === 'yes') return recommended;
    if (a === 'n' || a === 'no') return recommended.filter(s => s.kind === 'baseline');
    if (a === 's' || a === 'select') {
      const chosen = [];
      for (const skill of recommended) {
        if (skill.kind === 'baseline') { chosen.push(skill); continue; }
        const ans = await rl.question(`  install ${skill.name}? [Y/n] `);
        if (ans.trim().toLowerCase() !== 'n') chosen.push(skill);
      }
      return chosen;
    }
    return recommended;
  } finally {
    rl.close();
  }
}

// Branch-protection setup step at the end of `clud-bug init`.
// Offers to enable required_conversation_resolution on the default
// branch via gh API. Skipped cleanly when --no-set-protection is
// passed. Failure modes (no admin perms, no base protection rule,
// network error) all degrade to advisory log messages — they never
// fail the init run.
//
// gh and prompt are injectable for tests (defaults to spawning real
// gh + reading from real stdin).
async function runInitBranchProtection(args, { gh, prompt } = {}) {
  if (!args.setProtection) {
    log('');
    log('🐛 Branch protection: skipped (--no-set-protection).');
    return;
  }
  log('');
  log('🐛 Branch protection');

  // Detect repo + default branch. If gh isn't installed or the local
  // dir isn't a github repo, treat as advisory and move on.
  let owner, repo, branch;
  try {
    ({ owner, repo } = await detectRepo({ gh }));
    branch = await detectDefaultBranch({ owner, repo, gh });
  } catch (err) {
    log(`  Could not detect repo/branch (${err.message.split('\n')[0]}). Skipping.`);
    log('  You can enable it manually: gh api -X POST repos/<owner>/<repo>/branches/<default>/protection/required_conversation_resolution');
    return;
  }

  log(`  Default branch: ${branch}`);

  // Inspect current state.
  const current = await getProtectionState({ owner, repo, branch, gh });
  if (current.state === 'enabled') {
    log('  required_conversation_resolution: already on — your repo is all set.');
    return;
  }
  if (current.state === 'forbidden') {
    log('  Could not read branch protection (no admin perms). Ask the repo owner to enable required_conversation_resolution, or re-run with --no-set-protection to silence this prompt.');
    return;
  }
  if (current.state === 'unknown') {
    log(`  Could not read branch protection (${current.reason}). Skipping.`);
    return;
  }

  // Short-circuit on no-protection BEFORE prompting. The single-flag
  // POST endpoint requires a base protection rule on the branch — if
  // there's none, enableConversationResolution would just 404. Skip
  // the prompt and go straight to the actionable guidance (set up
  // basic protection first, then re-run).
  if (current.state === 'no-protection') {
    log('  required_conversation_resolution: not set (no base protection rule on this branch)');
    log('  Cannot enable yet: this branch has no base protection rule.');
    log(`    Set one up first: Settings → Branches → Add rule for ${branch}`);
    log('    Then re-run clud-bug init (or toggle the setting in the GUI).');
    return;
  }

  // current.state is 'disabled'.
  log('  required_conversation_resolution: not set');

  // Decide whether to prompt.
  let shouldEnable;
  if (args.acceptAll) {
    // --accept-all is a real side-effect flag here: it flips a
    // merge-gating repo setting. Make that explicit in the log so
    // CI users running `clud-bug init --accept-all` see exactly
    // what's happening instead of silently noticing later.
    log('  --accept-all: will enable required_conversation_resolution. Pass --no-set-protection to skip.');
    shouldEnable = true;
  } else {
    const ask = prompt ?? (async (q) => {
      const rl = createInterface({ input, output });
      try { return await rl.question(q); } finally { rl.close(); }
    });
    log('');
    log('  Clud Bug auto-resolves its own review threads when fixes land.');
    log('  Without required_conversation_resolution, that doesn\'t actually gate merges.');
    const answer = await ask(`  Enable required_conversation_resolution on ${branch}? [Y/n] `);
    shouldEnable = !['n', 'no'].includes(answer.trim().toLowerCase());
  }

  if (!shouldEnable) {
    log('  Skipped. Re-run with --accept-all or set it manually anytime.');
    return;
  }

  const result = await enableConversationResolution({ owner, repo, branch, gh });
  if (result.ok) {
    log('  ✓ Enabled required_conversation_resolution.');
    return;
  }
  if (result.state === 'no-protection') {
    log('  Cannot enable: this branch has no base protection rule. Set up basic branch protection first:');
    log(`    Settings → Branches → Add rule for ${branch}`);
    log('  Then re-run clud-bug init (or just toggle the setting in the GUI).');
    return;
  }
  if (result.state === 'forbidden') {
    log('  Cannot enable: you do not have admin permissions on this repository.');
    log('  Ask the repo owner to enable it, or re-run with --no-set-protection to silence this prompt.');
    return;
  }
  log(`  Cannot enable (${result.reason}). You can enable it manually anytime.`);
}

async function runList(_args) {
  const skillsDir = join(process.cwd(), '.claude', 'skills');
  const groups = await listInstalled(skillsDir);
  const total = groups.baseline.length + groups.remote.length + groups.custom.length;
  if (total === 0) {
    log('Empty collection. Run `clud-bug init` to open field season.');
    ok('list: 0 skills installed (run `clud-bug init` first)');
    return;
  }
  log(`🐛 ${total} specimen${total === 1 ? '' : 's'} pinned in .claude/skills/`);
  if (groups.baseline.length) {
    log('');
    log('Baseline (always pinned):');
    for (const s of groups.baseline) log(`  • ${s.slug}`);
  }
  if (groups.remote.length) {
    log('');
    log('From skills.sh:');
    for (const s of groups.remote) log(`  • ${s.slug}  ${s.source ? `[${s.source}]` : ''}`);
  }
  if (groups.custom.length) {
    log('');
    log('Custom (your own — never auto-modified):');
    for (const s of groups.custom) {
      log(`  • ${s.slug}${s.description ? `  — ${s.description}` : ''}`);
    }
  }
  ok(`list: ${total} skills (baseline=${groups.baseline.length}, remote=${groups.remote.length}, custom=${groups.custom.length})`);
}

async function runAdd(args) {
  const ref = args._[1];
  if (!ref || !ref.includes('/')) {
    process.stderr.write('Usage: clud-bug add <source/name>  (e.g. vercel-labs/skills/next-best-practices)\n');
    process.exit(2);
  }
  // Last segment is the skill name; everything before is the source repo path.
  const lastSlash = ref.lastIndexOf('/');
  const source = ref.slice(0, lastSlash);
  const name = ref.slice(lastSlash + 1);
  const skillsDir = join(process.cwd(), '.claude', 'skills');
  log(`  fetching ${source}/${name} from skills.sh...`);
  const client = new SkillsClient();
  const entry = await writeSkill(skillsDir, { source, name, kind: 'remote' }, client);
  const manifest = await readManifest(skillsDir);
  // Mutate in place so caller-set fields on the manifest (pinVersion,
  // lastUpdate, lastUpdateVersion) survive the add. Building a fresh
  // {version, installed} object would silently drop them.
  manifest.installed = [...manifest.installed.filter((e) => e.slug !== entry.slug), entry];
  await writeManifest(skillsDir, manifest);
  log(`  ✓ pinned ${entry.slug} → .claude/skills/${entry.slug}/SKILL.md`);
  log('  Commit + push to apply on the next PR.');
  ok(`added: .claude/skills/${entry.slug}/SKILL.md`);
}

async function runRemove(args) {
  const slug = args._[1];
  if (!slug) {
    process.stderr.write('Usage: clud-bug remove <slug>  (run `clud-bug list` to see installed slugs)\n');
    process.exit(2);
  }
  const skillsDir = join(process.cwd(), '.claude', 'skills');
  const entry = await removeSkill(skillsDir, slug);
  log(`  ✓ unpinned ${entry.slug}${entry.kind === 'baseline' ? ' (baseline — returns on next init)' : ''}`);
  ok(`removed: ${entry.slug}${entry.kind === 'baseline' ? ' (baseline)' : ''}`);
}

async function runRefresh(args) {
  const cwd = process.cwd();
  const skillsDir = join(cwd, '.claude', 'skills');
  const manifest = await readManifest(skillsDir);
  if (manifest.installed.length === 0) {
    log('No clud-bug-managed specimens found. Run `clud-bug init` first.');
    ok('refreshed: 0 skills installed (run `clud-bug init` first)');
    return;
  }

  log('  re-surveying habitat...');
  const signals = await detect(cwd);
  log(`    primary language: ${signals.primaryLanguage || '(unknown)'}`);
  log(`    search terms:     ${signals.searchTerms.join(', ') || '(none)'}`);

  const baseline = await loadBaseline(BASELINE_DIR);
  let curated = [];
  let searched = [];
  if (args.offline) {
    log('  --offline: skipping skills.sh — only baseline additions will be diffed; existing remote skills are preserved');
  } else {
    const client = new SkillsClient();
    let curatedErr, searchedErr;
    [curated, searched] = await Promise.all([
      client.curated().catch(err => { curatedErr = err; return []; }),
      client.search(signals.searchTerms).catch(err => { searchedErr = err; return []; }),
    ]);
    if (curatedErr || searchedErr) {
      const err = curatedErr || searchedErr;
      warn(`skills.sh unreachable (${err.message})`);
      warn('refusing to compute removals — an empty API response would look like "delete everything from skills.sh".');
      warn('Try again later, or run with --offline to install only baseline updates.');
      process.exit(1);
    }
  }
  const recommended = rankAndCap(curated, searched, baseline);
  const diff = diffManifest(manifest, recommended);

  // In --offline mode the recommendation set isn't authoritative (we only have
  // baseline locally), so any "missing from recommendations" entry is a false
  // positive. Suppress removals to avoid mass-deleting the user's remote skills.
  if (args.offline) diff.remove = [];

  log('');
  log(`  add:       ${diff.add.length}`);
  log(`  remove:    ${diff.remove.length} (custom skills untouched)`);
  log(`  unchanged: ${diff.unchanged.length}`);

  if (diff.add.length === 0 && diff.remove.length === 0) {
    log('');
    log('Collection in sync with skills.sh — nothing to update.');
    ok(`refreshed: ${diff.unchanged.length} skills in sync, 0 changes`);
    return;
  }

  log('');
  for (const s of diff.add)    log(`  + ${s.name} [${s.source || s.kind}]`);
  for (const s of diff.remove) log(`  - ${s.slug} [${s.source || s.kind}]`);

  if (!args.acceptAll) {
    const rl = createInterface({ input, output });
    const answer = await rl.question('\nApply these changes? [y/N] ');
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') {
      log('Aborted. No files changed.');
      return;
    }
  }

  const client = new SkillsClient();
  if (diff.add.length) await writeSkills(skillsDir, diff.add, client);
  for (const entry of diff.remove) await removeSkill(skillsDir, entry.slug);
  log('  ✓ collection updated. Commit + push to apply on the next PR.');
  ok(`refreshed: +${diff.add.length} -${diff.remove.length} (${diff.unchanged.length} unchanged)`);
}

async function runEditWorkflow(_args) {
  const cwd = process.cwd();

  // Validate: must have pending changes, all scoped to clud-bug workflow files.
  let pending;
  try {
    pending = getPendingWorkflowEdits(cwd);
  } catch (err) {
    process.stderr.write(`clud-bug edit-workflow: ${err.message}\n`);
    process.exit(2);
  }

  if (pending.files.length === 0) {
    log('Nothing to commit. Edit your .github/workflows/clud-bug-*.yml file(s) first, then re-run.');
    ok('branch: (none — no pending workflow edits)');
    return;
  }
  if (!pending.allWorkflow) {
    process.stderr.write(`clud-bug edit-workflow: working tree contains non-workflow changes:\n`);
    for (const f of pending.nonWorkflow) process.stderr.write(`  ${f}\n`);
    process.stderr.write(`\nThis command is for isolated workflow-only PRs. Stash or commit the\nnon-workflow changes elsewhere first, then re-run.\n`);
    process.exit(2);
  }

  log('🐛 Preparing an isolated PR for your workflow edit.');
  const branch = makeBranchName();
  log(`  branch: ${branch} (rooted at origin/main)`);
  for (const f of pending.files) log(`    • ${f}`);

  // Stash the pending workflow changes, branch from origin/main explicitly
  // (NOT from HEAD — if the user is on a feature branch with unrelated
  // commits, those would otherwise leak into the "isolated" PR), then
  // restore the changes onto the new branch and commit.
  gitCmd(cwd, ['stash', 'push', '--include-untracked', '-m', 'clud-bug edit-workflow']);
  try {
    gitCmd(cwd, ['fetch', 'origin', 'main', '--depth=1']);
    gitCmd(cwd, ['checkout', '-b', branch, 'origin/main']);
  } catch (err) {
    // Restore the user's stash before bubbling up.
    gitCmd(cwd, ['stash', 'pop'], { allowFail: true });
    throw err;
  }
  const popped = gitCmd(cwd, ['stash', 'pop'], { allowFail: true });
  if (!popped.ok) {
    process.stderr.write(`clud-bug edit-workflow: stash pop conflicted on origin/main — your edits are still in 'git stash'. Resolve manually:\n  git stash pop\n`);
    process.exit(1);
  }
  gitCmd(cwd, ['add', ...pending.files]);
  gitCmd(cwd, ['commit', '-m', 'Edit clud-bug workflow']);
  gitCmd(cwd, ['push', '-u', 'origin', branch]);

  log('');
  log('Done. Open the PR:');
  log(`  gh pr create --title "Edit clud-bug workflow" --body "Workflow tweak. The clud-bug-review check on this PR will fail with a 401 (Anthropic's self-protection against PRs that modify the reviewer's own workflow); merge once and subsequent PRs work normally."`);
  ok(`branch: ${branch} (${pending.files.length} file${pending.files.length === 1 ? '' : 's'})`);
}

async function runUpdateCmd(_args) {
  const cwd = process.cwd();
  const ourVersion = await readPkgVersion();
  log(`🐛 Refreshing the field kit (${ourVersion}).`);

  const result = await runUpdate({
    cwd,
    templatesDir: TEMPLATES,
    baselineDir: BASELINE_DIR,
    ourVersion,
  });

  if (result.missing === 'init') {
    log('  No clud-bug installation detected. Run `clud-bug init` first.');
    ok('updated: 0 changes (no clud-bug install detected)');
    return;
  }

  const skipped = result.skipped ?? [];

  if (result.changed.length === 0 && skipped.length === 0) {
    log('  Already current. Nothing to update.');
    ok(`updated: @v${ourVersion}, 0 changes`);
    return;
  }

  if (result.changed.length > 0) {
    log(`  ✓ Updated ${result.changed.length} file${result.changed.length === 1 ? '' : 's'}:`);
    for (const c of result.changed) {
      const versionNote = c.from && c.to && c.from !== c.to ? `  (${c.label}, ${c.from} → ${c.to})` : `  (${c.label})`;
      log(`     • ${rel(cwd, c.path)}${versionNote}`);
    }
  }
  if (result.unchanged.length > 0) {
    log(`  ${result.unchanged.length} file${result.unchanged.length === 1 ? ' was' : 's were'} already current.`);
  }
  if (skipped.length > 0) {
    log('');
    log(`  ! Skipped ${skipped.length} markerless file${skipped.length === 1 ? '' : 's'} (treated as user-customized):`);
    for (const s of skipped) log(`     • ${rel(cwd, s.path)}  — ${s.reason}`);
  }
  log('');
  log('Commit + push to apply the refreshed kit on the next PR.');
  ok(`updated: @v${ourVersion}, ${result.changed.length} changed, ${result.unchanged.length} unchanged${skipped.length ? `, ${skipped.length} skipped` : ''}`);
}

// v0.7.0-rc.4 — `clud-bug configure-github <owner>/<repo>`. Pulls in the
// SPEC §7 canonical ruleset applier from src/cli/configure-github.ts;
// thin wrapper here just maps CLI args into the typed entry point. The
// command is idempotent — re-runs on a converged repo exit 0 with no
// create/update calls. See `src/core/configure-github.ts` for the diff + rule
// table.
async function runConfigureGithubCmd(args) {
  const { runConfigureGithub } = await import('./configure-github.js');
  const target = args._[1] ?? null;
  const code = await runConfigureGithub({
    target,
    preset: args.preset || undefined,
    branch: args.branch || 'main',
    dryRun: Boolean(args.dryRun),
    quiet: QUIET,
    json: Boolean(args.json),
  });
  if (code !== 0) process.exit(code);
}

async function runAudit(args) {
  const cwd = process.cwd();
  const date = new Date().toISOString().slice(0, 10);

  let scopeLabel;
  if (args.since) scopeLabel = `commits since ${args.since}`;
  else if (args.changedIn) scopeLabel = `files changed in the past ${args.changedIn}`;
  else if (args.scopes.length) scopeLabel = `glob ${args.scopes.join(', ')}`;
  else scopeLabel = 'all tracked files';

  log(`🐛 Audit walk in ${cwd}.`);
  log(`  scope: ${scopeLabel}`);

  let files;
  try {
    files = computeAuditFileSet({
      cwd,
      since: args.since,
      changedIn: args.changedIn,
      scopes: args.scopes,
    });
  } catch (err) {
    process.stderr.write(`clud-bug audit: ${err.message}\n`);
    process.exit(2);
  }
  log(`  surveyed: ${files.length} file${files.length === 1 ? '' : 's'}`);

  if (files.length === 0) {
    log('  Nothing in scope. Try widening --scope or --changed-in.');
    ok(`audit: 0 files in scope`);
    return;
  }

  const outPath = args.out || join(cwd, 'audits', `${date}.md`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, renderAuditHeader({ date, scopeLabel, files }));
  log(`  ✓ wrote stub: ${rel(cwd, outPath)}`);
  log('');
  log('Stub is empty findings — populated by the GitHub Action.');
  log('Run locally without the workflow if you want — Clud Bug review needs the action runner + ANTHROPIC_API_KEY.');
  ok(`audit: ${files.length} file${files.length === 1 ? '' : 's'} surveyed; stub at ${rel(cwd, outPath)}`);
}

// 0.0.M.1 (v0.6.13): Q7-clud-bug $/LOC dashboard.
//
// Reads recent clud-bug-review run JSON via `gh run list` + per-job logs
// (which contain the SDK result messages with token counts + model),
// joins to `gh pr view --json additions,deletions` for the LOC denominator,
// and reports the rollup. Internal-only — not consumer-facing.
//
// Default scope: 30 days, all repos with clud-bug-review.yml in the gh
// user's auth scope. --repo / --pr / --since / --limit narrow.
async function runUsage(args) {
  // v0.6.28 — `clud-bug usage --health`: deterministic skill-health
  // dashboard. Reads `.claude/skills/.clud-bug.json` usage block,
  // applies thresholds, renders read-only table. No automation acts
  // on the output. Per the pragmatic SkDD pivot (2026-05-30).
  if (args.health) {
    return runUsageHealth(args);
  }

  const limit = args.limit ?? 50;
  const since = args.since ?? '30d';

  // Determine target repos. If --repo specified, just that one. Otherwise
  // discover repos via the local gh user's auth scope (the org's repos we
  // own clud-bug-review on).
  const repos = args.repo
    ? [args.repo]
    : await discoverConsumingRepos();

  if (repos.length === 0) {
    process.stderr.write(
      'clud-bug usage: no repos with clud-bug-review.yml found in your gh scope.\n' +
      'Pass --repo <owner/name> to point at a specific repo.\n'
    );
    process.exit(2);
  }

  // Per-repo: list recent clud-bug-review runs + extract the per-run job
  // logs + per-PR LOC counts. Filter to PR runs (drop schedule/dispatch).
  // PR #104 fix: --pr filter must be applied AFTER resolvePrNumber
  // (we don't have the PR # until then). prFilter on listRecentRuns was
  // promised but never applied — bug caught by clud-bug self-review.
  const reviews = [];
  for (const repo of repos) {
    const runs = await listRecentRuns(repo, limit, since, args.pr);
    if (process.env.CLUD_BUG_DEBUG) process.stderr.write(`DBG: ${repo} runs=${runs.length}\n`);
    for (const run of runs) {
      const review = await fetchReviewRecord(repo, run);
      if (process.env.CLUD_BUG_DEBUG) process.stderr.write(`DBG:   ${run.databaseId} ${run.conclusion} → ${review ? 'OK' : 'NULL'}\n`);
      if (!review) continue;
      // --pr filter: drop reviews whose PR doesn't match.
      if (args.pr != null && review.pr !== args.pr) continue;
      reviews.push(review);
    }
  }

  if (reviews.length === 0) {
    process.stderr.write(
      `clud-bug usage: no clud-bug-review runs found in scope.\n` +
      `  scope: ${repos.length} repo${repos.length === 1 ? '' : 's'}, last ${since}, limit ${limit}.\n`
    );
    process.exit(2);
  }

  const summary = rollup(reviews);
  process.stdout.write(formatRollup(summary, { json: args.json }));
  if (!args.json) {
    ok(`usage: ${reviews.length} review${reviews.length === 1 ? '' : 's'} across ${repos.length} repo${repos.length === 1 ? '' : 's'}`);
  }
}

// `gh repo list` won't filter by workflow file content, so we iterate
// repos the user has access to and probe for clud-bug-review.yml. We
// v0.6.28 — `clud-bug usage --health` implementation. Reads the local
// .claude/skills/.clud-bug.json usage block, applies deterministic
// thresholds, renders a read-only dashboard. No I/O beyond the JSON
// read.
//
// v0.6.30 — read accumulated usage from workflow artifacts (uploaded
// by v0.6.29's post-step). Defaults to artifact mode when --repo is
// passed OR an `owner/name` can be inferred from `git remote`. Falls
// back to the local-file path otherwise. The `--no-artifacts` flag
// forces the v0.6.28 local-only behavior (handy for tests + offline).
async function runUsageHealth(args) {
  const { assessSkillHealth, formatHealthDashboard } = await import('./skill-usage.js');

  // Decide read source. Priority: explicit --no-artifacts → local;
  // explicit --repo OR inferred owner/repo → artifacts; else local.
  const wantArtifacts = args.artifacts !== false;
  let ownerRepo = null;
  if (wantArtifacts) {
    ownerRepo = args.repo || await inferOwnerRepoFromGit();
  }

  let usage;
  let source;
  if (wantArtifacts && ownerRepo) {
    const result = await loadUsageFromArtifacts(ownerRepo, args);
    if (result) {
      usage = result.usage;
      source = `${result.artifactCount} artifact${result.artifactCount === 1 ? '' : 's'} from ${ownerRepo}`;
    }
  }

  // Fallback to local .clud-bug.json (v0.6.28 behavior).
  if (usage == null) {
    const localResult = await loadUsageFromLocalFile();
    if (localResult == null) {
      // Both paths failed. The local helper has already written its
      // own stderr explanation; we just exit.
      process.exit(1);
    }
    usage = localResult;
    source = `local .clud-bug.json`;
  }

  const rows = assessSkillHealth(usage, new Date());
  process.stdout.write(formatHealthDashboard(rows) + '\n');

  // Exit code semantics: 0 (informational). The dashboard is read-only;
  // archive-candidates being present is NOT a failure mode — humans
  // decide. CI gates should NOT block on this.
  ok(`skill health: ${rows.length} skill${rows.length === 1 ? '' : 's'} tracked (source: ${source})`);
}

// Helpers split out from runUsageHealth so the two read paths are
// independently testable + composable in future commands.

async function loadUsageFromArtifacts(ownerRepo, args) {
  const { fetchUsageArtifacts, aggregateUsageStream } = await import('./skill-usage.js');
  const [owner, repo] = ownerRepo.split('/');
  if (!owner || !repo) {
    process.stderr.write(`clud-bug usage --health: --repo must be in owner/name form, got "${ownerRepo}".\n`);
    return null;
  }
  const since = parseSinceArg(args.since);
  let artifacts;
  try {
    artifacts = await fetchUsageArtifacts({ owner, repo, since });
  } catch (err) {
    process.stderr.write(`::notice::clud-bug usage --health: artifact fetch failed (${err.message}) — falling back to local .clud-bug.json\n`);
    return null;
  }
  if (artifacts.length === 0) {
    process.stderr.write(`::notice::clud-bug usage --health: no skill-usage artifacts found in ${ownerRepo} — falling back to local .clud-bug.json\n`);
    return null;
  }
  return {
    usage: aggregateUsageStream(artifacts),
    artifactCount: artifacts.length,
  };
}

async function loadUsageFromLocalFile() {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const jsonPath = path.resolve(process.cwd(), '.claude', 'skills', '.clud-bug.json');
  try {
    const raw = await fs.readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return (parsed && parsed.usage) ? parsed.usage : {};
  } catch (err) {
    if (err.code === 'ENOENT') {
      process.stderr.write(
        `clud-bug usage --health: no .claude/skills/.clud-bug.json found in ${process.cwd()}.\n` +
        `Run \`npx clud-bug init\` first OR pass --repo owner/name to read from workflow artifacts.\n`
      );
      return null;
    }
    process.stderr.write(`clud-bug usage --health: failed to parse .clud-bug.json: ${err.message}\n`);
    return null;
  }
}

async function inferOwnerRepoFromGit() {
  // `gh repo view --json nameWithOwner` reads the current dir's git
  // remote AND respects gh's config. Returns null on non-git dirs.
  const result = await ghJson(['repo', 'view', '--json', 'nameWithOwner']);
  return result && result.nameWithOwner ? result.nameWithOwner : null;
}

function parseSinceArg(since) {
  if (!since) return null;
  if (since instanceof Date) return since;
  const m = String(since).match(/^(\d+)([dwmy])$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unitMs = { d: 86400e3, w: 7 * 86400e3, m: 30 * 86400e3, y: 365 * 86400e3 }[m[2]];
  return new Date(Date.now() - n * unitMs);
}

// limit to 100 to avoid pagination explosions.
async function discoverConsumingRepos() {
  const list = await ghJson(['repo', 'list', '--limit', '100', '--json', 'nameWithOwner']);
  if (!Array.isArray(list)) return [];
  const owners = list.map((e) => e.nameWithOwner);
  const found = [];
  for (const ownerRepo of owners) {
    const probe = await gh(['api', `repos/${ownerRepo}/contents/.github/workflows/clud-bug-review.yml`, '-q', '.size']);
    if (probe.code === 0 && probe.stdout.trim().length > 0) {
      found.push(ownerRepo);
    }
  }
  return found;
}

// List recent clud-bug-review.yml runs in a repo. Filters to PR events
// (drops schedule, workflow_dispatch — those have no PR LOC denominator).
//
// IMPORTANT (Q7 measurement integrity, fixed during PR #104 review):
// We INCLUDE conclusion === 'failure' runs because Anthropic bills for
// tokens regardless of GitHub workflow conclusion. A run that hit the
// spend cap, errored mid-action, or failed strict-mode still incurred
// real API cost — silently excluding it would underreport spend and
// fool the Q7-clud-bug "gradient must point down" gate.
// extractTokensFromLog() returns ok:false on logs without usable token
// totals, which gracefully skips the cancelled/errored-too-early case
// without losing accountability for the partially-billed runs.
async function listRecentRuns(repo, limit, since, prFilter) {
  const sinceDate = since.match(/^\d+[dwmy]$/) ? dateAgo(since) : null;
  const args = [
    'run', 'list', '-R', repo,
    '--workflow', 'clud-bug-review.yml',
    '--limit', String(limit),
    '--json', 'databaseId,headSha,createdAt,event,status,conclusion',
  ];
  if (sinceDate) args.push('--created', `>=${sinceDate}`);
  const runs = await ghJson(args);
  if (!Array.isArray(runs)) return [];
  return runs
    .filter((r) => r.event === 'pull_request' && (r.conclusion === 'success' || r.conclusion === 'failure'))
    .map((r) => ({ ...r, repo }))
    .slice(0, limit);
}

async function fetchReviewRecord(repo, run) {
  // Find the clud-bug-review JOB id within the run.
  const jobs = await ghJson(['api', `repos/${repo}/actions/runs/${run.databaseId}/jobs`, '-q', '.jobs']);
  if (!Array.isArray(jobs)) return null;
  const job = jobs.find((j) => j.name === 'clud-bug-review');
  if (!job) return null;

  // Fetch the job's log dump. May be large.
  const logs = await gh(['api', `repos/${repo}/actions/jobs/${job.id}/logs`]);
  if (logs.code !== 0) return null;

  // Extract tokens + model from the SDK result-message JSON in the log.
  const extracted = extractTokensFromLog(logs.stdout);
  if (!extracted.ok) return null;

  // Resolve the PR number from the run's pull_requests array or by SHA.
  const prNumber = await resolvePrNumber(repo, run);
  if (!prNumber) return null;

  // Pull LOC denominator from the PR.
  const prMeta = await ghJson(['pr', 'view', String(prNumber), '-R', repo, '--json', 'additions,deletions,number']);
  if (!prMeta || typeof prMeta.additions !== 'number') return null;

  const tokens = extracted.tokens;
  const model = extracted.model;
  const costInfo = computeReviewCost(tokens, model);
  return {
    repo,
    pr: prNumber,
    createdAt: run.createdAt,
    model: costInfo.model,                  // normalized (PRICING key)
    modelObserved: model,                   // raw value from log (may be versioned)
    unknownModel: costInfo.unknownModel,    // PR #104 fix: surface for dashboard warn
    tokens,
    additions: prMeta.additions,
    deletions: prMeta.deletions,
    cost: costInfo.total,
    costPerLOC: costPerLOC(costInfo.total, prMeta.additions, prMeta.deletions),
    cacheRate: cacheHitRate(tokens),
  };
}

async function resolvePrNumber(repo, run) {
  // gh's run JSON sometimes carries a `pull_requests` array; if not (or
  // if it's empty because the PR has been merged), look up via the
  // commits/{sha}/pulls endpoint, which includes merged/closed PRs.
  const detail = await ghJson(['api', `repos/${repo}/actions/runs/${run.databaseId}`, '-q', '.pull_requests']);
  if (Array.isArray(detail) && detail[0]?.number) return detail[0].number;
  // commits/{sha}/pulls returns PRs that contain the commit — works for
  // open AND merged/closed PRs. The default `gh pr list -S <sha>` does
  // not search closed PRs and silently returns empty for the merged
  // case, which made every $/LOC lookup fail on historical PRs.
  const pulls = await ghJson(['api', `repos/${repo}/commits/${run.headSha}/pulls`, '-q', '[.[].number]']);
  if (Array.isArray(pulls) && pulls.length > 0) return pulls[0];
  return null;
}

function dateAgo(spec) {
  // spec like "30d", "2w", "1m", "1y" → ISO date N units ago.
  const m = spec.match(/^(\d+)([dwmy])$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const day = 24 * 60 * 60 * 1000;
  const ms = n * (unit === 'd' ? day : unit === 'w' ? 7 * day : unit === 'm' ? 30 * day : 365 * day);
  return new Date(Date.now() - ms).toISOString().slice(0, 10);
}

// gh helpers (reuse pattern from lib/branch-protection.js so callers can
// stub `gh` in tests if they want — but for now spawn directly).
function gh(args) {
  return new Promise((resolve) => {
    const child = spawn('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', () => resolve({ code: 1, stdout: '', stderr: 'gh not on PATH' }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function ghJson(args) {
  const { code, stdout } = await gh(args);
  if (code !== 0) return null;
  try { return JSON.parse(stdout); } catch { return null; }
}

function rel(from, to) {
  return to.startsWith(from + '/') ? to.slice(from.length + 1) : to;
}

// Quiet-mode mechanism (v0.6.7+):
// - Default: log() emits progress to stdout (today's behavior).
// - When CLUD_BUG_QUIET=1 OR --quiet/-q is passed: log() is suppressed.
//   ok() ALWAYS emits its single-line summary so agents get positive
//   confirmation with a chainable key-value (commit SHA, file count,
//   branch name) regardless of quiet state.
// - warn() / die() emit unconditionally — quiet must not silence real
//   problems.
let QUIET = process.env.CLUD_BUG_QUIET === '1';
function setQuiet(flag) { QUIET = !!flag; }
function log(msg) { if (!QUIET) process.stdout.write(msg + '\n'); }
function ok(msg) { process.stdout.write('ok ' + msg + '\n'); }
function warn(msg) { process.stderr.write(`  ! ${msg}\n`); }

/**
 * #276 — write the git `pre-push` hook (SPEC 2.0 §6.7).
 *
 * The fs counterpart of `hooks.ts:planPrePushInstall`, which owns every
 * decision; this only performs the one it returns. Mirrors the commit hook's
 * install contract (`main.ts` → `mergeLocalReviewHook`): idempotent, never
 * clobbers content clud-bug did not write, and never fails `init`.
 *
 * `git rev-parse --git-path hooks` — not a hardcoded `.git/hooks` — because it
 * honours `core.hooksPath` and, inside a linked worktree, resolves to the
 * SHARED common dir (git runs one pre-push per repo, not per worktree). Same
 * reasoning as #240 vector 1 for the commit hook's bookkeeping.
 */
async function installPrePushHook(cwd) {
  const { buildPrePushHookScript, planPrePushInstall, PREPUSH_HOOK_FILE } = await import('./hooks.js');
  const { chmod, rename, stat } = await import('node:fs/promises');

  const hooksDirResult = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd, encoding: 'utf8' });
  if (hooksDirResult.status !== 0) {
    warn('Not a git repository (or git unavailable) — skipped the pre-push review hook.');
    return;
  }
  // `--git-path` yields a path relative to the repo root; resolve against cwd.
  const hooksDir = join(cwd, hooksDirResult.stdout.trim());
  const hookPath = join(hooksDir, PREPUSH_HOOK_FILE);

  let existing;
  try {
    existing = await readFile(hookPath, 'utf8');
  } catch {
    existing = undefined; // no pre-push hook yet
  }
  let chainedExists = false;
  try {
    const { PREPUSH_CHAINED_FILE } = await import('./hooks.js');
    await stat(join(hooksDir, PREPUSH_CHAINED_FILE));
    chainedExists = true;
  } catch {
    chainedExists = false;
  }

  const plan = planPrePushInstall({ existing, chainedExists, script: buildPrePushHookScript() });
  if (plan.action === 'skip') {
    warn(`Skipped the pre-push review hook — ${plan.reason}`);
    return;
  }
  try {
    await mkdir(hooksDir, { recursive: true });
    if (plan.action === 'chain') {
      // Move, never delete: a hook we cannot read is still somebody's gate.
      await rename(hookPath, join(hooksDir, plan.moveExistingTo));
    }
    await writeFile(hookPath, plan.content);
    await chmod(hookPath, 0o755);
    log(`    wrote ${rel(cwd, hookPath)} (pre-push review hook — ${plan.reason})`);
  } catch (err) {
    // Never fail `init` over a hook: an unwritable hooks dir (a read-only
    // .git, a hooksPath pointing somewhere managed) leaves the repo exactly as
    // it was, and the GitHub Action path is unaffected.
    warn(`Could not write the pre-push review hook (${err && err.message}) — left the repo untouched.`);
  }
}

// Export `main()` so the entry-point shim at bin/clud-bug.js can drive
// the dispatch. The shim wraps the catch + process.exit error path.
export { main };
