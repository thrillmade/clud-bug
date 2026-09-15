#!/usr/bin/env node
// Planted-defect benchmark runner (#270, SPEC 2.0 §8.2 — "A reviewer MUST
// periodically be given a change carrying a defect whose presence is known in
// advance, and MUST report it").
//
//   node scripts/run-benchmark.mjs --trigger schedule           # cap: see parseArgs
//   node scripts/run-benchmark.mjs --dry-run --out /tmp/bench   # no key, no network
//
// For each scenario it materialises a throwaway git repo shaped the way the
// Action sees a pull request — the pre-existing files in a base commit, the
// changed module in a second commit on a branch — runs one headless reviewer
// over it, and scores the structured output against the committed answer key.
//
// Everything about HOW the reviewer is invoked is read from the rendered
// workflow template and the recipe builder rather than restated here: the
// system prompt comes from `reviewPrompt()`, and the tool allow-list, the
// default model and the thinking budget are parsed out of the SAME template
// `clud-bug init` would render for this corpus — `pickTemplate()` picks it
// once and both halves follow. A benchmark that drifts from the shipped
// recipe measures something nobody runs.
//
// Imports from `dist/` — run `npm run build` first.
//
// Three things this script will not do, because each would publish a number
// that is not a measurement:
//   - a `--dry-run` result may not be written to the default results dir, and
//     carries `dryRun: true` so the renderer refuses it;
//   - nor may a `--suite` subset: the scenarios it filters out never reach the
//     scorer, so they are absent from the counts rather than `unverified`, and
//     the sentence would name a smaller corpus with no remainder named;
//   - the cost cap is checked BEFORE each call and charged for every call that
//     started — a reviewer that errored or timed out was billing too — and
//     every scenario left unrun is written as `unverified` (SPEC §4.9: "A
//     review cut short for cost is unverified, never clean"), never as clean.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCENARIOS = join(ROOT, 'benchmark', 'scenarios');
const SCHEMA_VERSION = 1;

// Every scenario is a `module.mjs`, so this is what `clud-bug init` detects
// for the corpus — and what decides both the workflow template the invocation
// contract is read from and the prompt variant the reviewer is given.
const CORPUS_LANGUAGES = ['javascript'];

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    suite: 'all',
    // The one owner of the ruled $12 cap: the workflow passes --cost-cap-usd
    // only when an operator chose one, so nothing restates this number.
    costCapUsd: 12,
    reviewers: 1,
    model: null,
    effort: null,
    seed: null,
    out: null,
    dryRun: false,
    fakeScript: null,
    materialiseOnly: null,
    fakeCostUsd: 0.1,
    estimateUsd: 0.5,
    trigger: 'manual',
    runId: null,
    claudeBin: process.env.CLAUDE_BIN || 'claude',
    timeoutMs: 15 * 60 * 1000,
  };
  const num = (v, name) => {
    const n = Number(v);
    if (!Number.isFinite(n)) fail(`--${name} expects a number, got ${JSON.stringify(v)}`);
    return n;
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--suite') opts.suite = argv[++i];
    else if (a === '--cost-cap-usd') opts.costCapUsd = num(argv[++i], 'cost-cap-usd');
    else if (a === '--reviewers') opts.reviewers = num(argv[++i], 'reviewers');
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--effort') opts.effort = argv[++i];
    else if (a === '--seed') opts.seed = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--fake-script') opts.fakeScript = argv[++i];
    else if (a === '--materialise-only') opts.materialiseOnly = argv[++i];
    else if (a === '--fake-cost-usd') opts.fakeCostUsd = num(argv[++i], 'fake-cost-usd');
    else if (a === '--estimate-usd') opts.estimateUsd = num(argv[++i], 'estimate-usd');
    else if (a === '--trigger') opts.trigger = argv[++i];
    else if (a === '--run-id') opts.runId = argv[++i];
    else if (a === '--claude-bin') opts.claudeBin = argv[++i];
    else if (a === '--timeout-ms') opts.timeoutMs = num(argv[++i], 'timeout-ms');
    else fail(`unknown option ${a}`);
  }
  return opts;
}

function fail(message) {
  console.error(`::error::run-benchmark: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// The one owner for how the reviewer is invoked: the shipped workflow template
// ---------------------------------------------------------------------------

// Takes the template NAME, not a path, and hands it back on the contract: the
// name the result file records is then the file the model and the allow-list
// were actually read from, rather than a second value chosen alongside it.
function readInvocationContract(templateName) {
  const templatePath = join(ROOT, 'templates', templateName);
  const tmpl = readFileSync(templatePath, 'utf8');

  const tools = tmpl.match(/--allowedTools "([^"]*)"/);
  if (!tools) fail(`no --allowedTools line in ${templatePath} — the runner mirrors it from there`);
  // The GitHub MCP inline-comment tool has no server outside the Action, so
  // it is dropped rather than passed to a binary that would reject it.
  const allowedTools = tools[1]
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && !t.startsWith('mcp__'));

  // The classifier's default, which every template assigns before it branches;
  // the later `MODEL=` lines are the downgrade for a trivial diff, so the
  // first assignment is the one a review is given. The `# default` comment is
  // present in one template and not the others, so it is not the anchor.
  const model = tmpl.match(/^\s*MODEL=(\S+?)(?:\s+#.*)?$/m);
  if (!model) fail(`no MODEL line in ${templatePath}`);

  const thinking = tmpl.match(/^\s*MAX_THINKING_TOKENS: '(\d+)'$/m);
  if (!thinking) fail(`no MAX_THINKING_TOKENS line in ${templatePath}`);

  return {
    template: templateName,
    allowedTools,
    defaultModel: model[1],
    defaultEffort: `${thinking[1]} thinking tokens`,
  };
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

function loadScenarios(suite) {
  const ids = readdirSync(SCENARIOS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const keys = ids.map((id) => {
    const key = JSON.parse(readFileSync(join(SCENARIOS, id, 'answer.json'), 'utf8'));
    if (key.id !== id) fail(`${id}/answer.json declares id ${key.id}`);
    return key;
  });

  if (suite === 'all') return keys;
  if (suite === 'planted') return keys.filter((k) => k.expected === 'finding');
  if (suite === 'decoys') return keys.filter((k) => k.expected === 'clean');
  const wanted = new Set(suite.split(',').map((s) => s.trim()).filter(Boolean));
  const picked = keys.filter((k) => wanted.has(k.id));
  const missing = [...wanted].filter((id) => !picked.some((k) => k.id === id));
  if (missing.length > 0) fail(`--suite names unknown scenarios: ${missing.join(', ')}`);
  return picked;
}

// A file whose header declares itself pre-existing belongs to the base commit;
// `module.mjs` is the change under review. The answer key, the scenario write-up
// and the reproduction are withheld from the reviewer entirely.
const WITHHELD = new Set(['SCENARIO.md', 'answer.json', 'reproduce.mjs']);

function classifyScenarioFiles(id) {
  const dir = join(SCENARIOS, id);
  const base = [];
  let head = null;
  for (const name of readdirSync(dir).sort()) {
    if (WITHHELD.has(name)) continue;
    if (name === 'module.mjs') {
      head = name;
      continue;
    }
    const header = readFileSync(join(dir, name), 'utf8').split('\n').slice(0, 4).join('\n');
    if (!/PRE-EXISTING/i.test(header)) {
      fail(`${id}/${name} is neither module.mjs nor marked PRE-EXISTING — cannot place it in the diff`);
    }
    base.push(name);
  }
  if (!head) fail(`${id} has no module.mjs`);
  return { dir, base, head };
}

function git(cwd, args) {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'clud-bug benchmark',
      GIT_AUTHOR_EMAIL: 'benchmark@clud-bug.invalid',
      GIT_COMMITTER_NAME: 'clud-bug benchmark',
      GIT_COMMITTER_EMAIL: 'benchmark@clud-bug.invalid',
    },
  });
}

/** Materialise one scenario as the two-commit repo the Action would review. */
function materialise(id, workdir) {
  const { dir, base, head } = classifyScenarioFiles(id);
  const repo = join(workdir, id);
  mkdirSync(repo, { recursive: true });

  git(repo, ['init', '--quiet', '--initial-branch=main']);
  // Skills are the reviewer's instructions and come from the base ref in the
  // Action (#288). Mirror that: they are part of the base commit, never of
  // the change under review.
  if (existsSync(join(ROOT, '.claude', 'skills'))) {
    cpSync(join(ROOT, '.claude', 'skills'), join(repo, '.claude', 'skills'), { recursive: true });
  }
  for (const name of base) cpSync(join(dir, name), join(repo, name));
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'base: pre-existing modules']);

  git(repo, ['checkout', '--quiet', '-b', 'pr']);
  cpSync(join(dir, head), join(repo, head));
  git(repo, ['add', '--', head]);
  git(repo, ['commit', '--quiet', '-m', `${id}: the change under review`]);

  return repo;
}

// ---------------------------------------------------------------------------
// The reviewer
// ---------------------------------------------------------------------------

const USER_PROMPT = `Review this change following the discipline in your system prompt — every
rule about skill routing, grounding, severity and the structured output
applies.

This is a local checkout rather than a GitHub pull request, so \`gh\` is not
available. The change under review is the single commit on this branch:

    git diff main...HEAD

Files present but absent from that diff are pre-existing context the change
only exposes. Report what the change breaks, wherever the cause lives, and
locate every finding with the file and line a maintainer would open.

Emit your review as the structured output your schema defines. Set
\`last_reviewed_sha\` to the output of \`git rev-parse HEAD\`.`;

/**
 * Why a payload is not a review, or null when it is one.
 *
 * WHOLE-PAYLOAD questions only: is it an object, and does it carry the
 * `critical_findings` array the scorer reads. The `structured_output` branch is
 * schema-validated by the CLI, but the `result` branch is whatever the model
 * typed inside a fence — and an object with no `critical_findings` scores as an
 * empty finding set, which on a decoy is indistinguishable from a reviewer that
 * looked and found nothing. That is the confusion §8.2 exists to prevent, so
 * both branches come through here.
 *
 * Per-FINDING shape is not asked here, because the answer here voids the whole
 * review: one malformed `line` among several — routine from an LLM, and the
 * reason the free-form branch exists at all — discarded a finding that had
 * located the planted defect and published the scenario as unscored.
 * `placeable()` in src/core/benchmark-score.ts owns that question one finding
 * at a time, which is the grain the verdict is decided at.
 */
function reviewShapeError(review) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) return 'review was not a JSON object';
  if (!Array.isArray(review.critical_findings)) return 'review carried no critical_findings array';
  return null;
}

/**
 * Pull the structured review out of `claude -p --output-format json`.
 *
 * ASSUMPTION (#270): the CLI's result envelope carries the schema-validated
 * object on `structured_output` when `--json-schema` is passed, and otherwise
 * leaves it as JSON text in `result`. Both are tried, and a payload that is
 * neither — or that parses but is not shaped like a review — is reported as
 * unverified rather than scored as clean. `--json-schema` and
 * `--max-budget-usd` are assumed to be accepted (2.1.272 documents both, the
 * second `--print`-only, which is how the reviewer is called); a CLI that
 * rejects either fails the call, and a failed call is unverified rather than
 * clean.
 */
function extractReview(stdout) {
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    return { review: null, reason: 'reviewer output was not JSON' };
  }
  if (envelope && typeof envelope === 'object' && envelope.is_error) {
    return { review: null, reason: `reviewer reported an error: ${String(envelope.result ?? '').slice(0, 200)}` };
  }
  const candidate = envelope?.structured_output ?? envelope?.result ?? null;
  let review = null;
  if (candidate && typeof candidate === 'object') {
    review = candidate;
  } else if (typeof candidate === 'string') {
    const fenced = candidate.match(/```(?:json)?\n([\s\S]*?)```/);
    const text = fenced ? fenced[1] : candidate;
    try {
      review = JSON.parse(text);
    } catch {
      return { review: null, reason: 'reviewer output carried no parseable structured review', envelope };
    }
  } else {
    return { review: null, reason: 'reviewer output carried no structured review', envelope };
  }
  const shapeError = reviewShapeError(review);
  if (shapeError) return { review: null, reason: `reviewer output is not a review: ${shapeError}`, envelope };
  return { review, envelope };
}

function callReviewer(opts, contract, repo, systemPrompt, schema, remainingUsd) {
  const args = [
    '-p',
    USER_PROMPT,
    '--output-format',
    'json',
    '--model',
    opts.model,
    '--append-system-prompt',
    systemPrompt,
    '--allowedTools',
    contract.allowedTools.join(','),
    '--json-schema',
    schema,
    // The only hard bound on a single call: the running total below can stop
    // the NEXT call, but nothing here can stop this one once it is away.
    '--max-budget-usd',
    String(Math.max(0, remainingUsd)),
  ];
  const run = spawnSync(opts.claudeBin, args, {
    cwd: repo,
    encoding: 'utf8',
    timeout: opts.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, MAX_THINKING_TOKENS: String(parseInt(opts.effort, 10) || 8000) },
  });
  if (run.error) {
    // A binary that was never there spent nothing. Anything else — a timeout
    // above all — was billing for as long as it ran, so it is charged like
    // any other call that reported no cost.
    return {
      review: null,
      reason: `reviewer did not run: ${run.error.message}`,
      costUsd: 0,
      spawnFailed: run.error.code === 'ENOENT',
    };
  }
  if (run.status !== 0) {
    const tail = String(run.stderr || '').trim().split('\n').slice(-3).join(' / ');
    return { review: null, reason: `reviewer exited ${run.status}: ${tail}`, costUsd: 0 };
  }
  const { review, reason, envelope } = extractReview(run.stdout);
  return { review, reason, costUsd: callCost(envelope, opts.model) };
}

/**
 * What the call cost. The CLI reports `total_cost_usd` directly; when it does
 * not, fall back to the same PRICING table `clud-bug usage` bills from so the
 * two never disagree about what a review costs.
 */
function callCost(envelope, model) {
  if (envelope && typeof envelope.total_cost_usd === 'number') return envelope.total_cost_usd;
  const usage = envelope?.usage;
  if (usage && typeof usage === 'object') return computeReviewCost(usage, model).total;
  return 0;
}

function fakeReviewer(opts, key, script) {
  const scripted = script?.[key.id];
  if (scripted) {
    return {
      review: scripted.review === null ? null : { critical_findings: scripted.findings ?? [] },
      reason: scripted.reason,
      costUsd: typeof scripted.costUsd === 'number' ? scripted.costUsd : opts.fakeCostUsd,
    };
  }
  // Unscripted dry run: a reviewer that answers the key exactly. It exercises
  // the plumbing and nothing else — `dryRun: true` keeps the result out of
  // anything published.
  const findings =
    key.expected === 'finding' ? [{ file: key.file, line: key.lineRange[0], summary: 'dry-run finding' }] : [];
  return { review: { critical_findings: findings }, costUsd: opts.fakeCostUsd };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const opts = parseArgs(process.argv);

// Where the run will write, resolved once and compared to the published dir
// rather than tested for having been named at all: `--out benchmark/results`
// IS an explicit `--out`, so "did the operator name one" passed it through and
// a dry run overwrote the published score with a fake one.
//
// The string compare alone still passes a `--out` that names the same
// directory under a different spelling — a case-variant path on a
// case-insensitive filesystem, or a symlink pointing at the published dir —
// so it is backed by a filesystem-identity check: same device and inode is
// the same directory no matter what string got it there. Neither side has to
// exist yet (a fresh `--out` does not), so a failed `statSync` just falls
// back to "not the same directory" and leaves the string compare as the
// answer.
const PUBLISHED_OUT = join(ROOT, 'benchmark', 'results');
const outDir = opts.out ? resolve(opts.out) : PUBLISHED_OUT;
function sameDirectory(a, b) {
  if (a === b) return true;
  try {
    const sa = statSync(a);
    const sb = statSync(b);
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}
const publishing = sameDirectory(outDir, PUBLISHED_OUT);

if (opts.dryRun && publishing) {
  fail(`--dry-run may not write the published results dir (${PUBLISHED_OUT}); pass --out <dir> elsewhere`);
}
if (opts.suite !== 'all' && publishing && !opts.materialiseOnly) {
  // The scenarios a subset filters out never reach the scorer, so they are
  // absent from the counts rather than `unverified` — a shortened run that
  // does not say it was shortened, which is what §2.8 prohibits. A subset is
  // a spot check and writes somewhere else.
  fail(`--suite ${opts.suite} may not write the published results dir; a partial run is not the published score`);
}
if (!existsSync(join(ROOT, 'dist', 'core', 'benchmark-score.js'))) {
  fail('dist/ is missing — run `npm run build` first');
}

const { scoreRun } = await import('../dist/core/benchmark-score.js');
const { reviewPrompt } = await import('../dist/core/prompts.js');
const { pickTemplate, templateLanguage } = await import('../dist/core/render.js');
const { serializedReviewSchema } = await import('../dist/core/review-schema.js');
const { computeReviewCost } = await import('../dist/cli/usage.js');

// One name, three consumers: the contract is read from it, the prompt variant
// is chosen by it, and the result file records it. It travels on the contract
// so the three cannot be picked apart — the contract was once read from the
// generic template while the prompt was rendered for the JS/TS one, and
// because the two ship the same model and allow-list today, nothing the run
// recorded moved when they diverged.
const contract = readInvocationContract(pickTemplate(CORPUS_LANGUAGES));

if (opts.materialiseOnly) {
  // Build the reviewer's inputs and stop — how a scenario is presented is the
  // half of §8.2 that has to be inspectable ("the defect lives in the
  // reviewer's input, never in the change").
  const target = resolve(opts.materialiseOnly);
  mkdirSync(target, { recursive: true });
  for (const key of loadScenarios(opts.suite)) {
    console.log(`  materialised  ${materialise(key.id, target)}`);
  }
  process.exit(0);
}

opts.model ??= contract.defaultModel;
opts.effort ??= contract.defaultEffort;

const keys = loadScenarios(opts.suite);

/**
 * The order the corpus is actually run in — which decides what a cost stop
 * leaves unrun.
 *
 * Directory order puts all six decoys in one block at the end, so a stop
 * inside the planted ones scored no decoys at all, and precision over no
 * decoys is 100% by arithmetic rather than by review. So: shuffle from the
 * seed, then interleave the planted defects and the decoys in proportion, so
 * every prefix of the run is a sample of both halves and not a prefix of one.
 * `keys` keeps corpus order, so the result file still reads the same way
 * every run whatever order it was produced in.
 */
function runOrder(scenarios, seed) {
  const rand = seeded(seed);
  const shuffled = [...scenarios];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const groups = [
    shuffled.filter((k) => k.expected === 'finding'),
    shuffled.filter((k) => k.expected === 'clean'),
  ].filter((group) => group.length > 0);
  const taken = groups.map(() => 0);
  const ordered = [];
  while (ordered.length < shuffled.length) {
    let pick = 0;
    let earliest = Infinity;
    groups.forEach((group, i) => {
      if (taken[i] >= group.length) return;
      // Where this group's next scenario falls if the group were spread
      // evenly across the whole run. Smallest goes next.
      const position = (taken[i] + 0.5) / group.length;
      if (position < earliest) {
        earliest = position;
        pick = i;
      }
    });
    ordered.push(groups[pick][taken[pick]++]);
  }
  return ordered;
}

function seeded(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const systemPrompt = reviewPrompt({
  projectDescription: 'A small JavaScript module under review.',
  // The JS/TS prompt carries focus bullets the generic one does not —
  // async/await handling among them, which b7 is planted against — so scoring
  // the generic variant measures a recipe no JavaScript repository is given.
  language: templateLanguage(contract.template),
});
const schema = serializedReviewSchema();
const fakeScript = opts.fakeScript ? JSON.parse(readFileSync(resolve(opts.fakeScript), 'utf8')) : null;

const startedAt = new Date().toISOString();
const runId = opts.runId ?? startedAt.replace(/[:.]/g, '-');
// The scheduled trigger passes no seed, and an order nothing recorded is a
// run nobody can reproduce — so the run id is the seed when nobody names one.
opts.seed ??= runId;
const order = runOrder(keys, opts.seed);
const workdir = mkdtempSync(join(tmpdir(), 'clud-bug-benchmark-'));

let spentUsd = 0;
let maxCallUsd = 0;
let spendEstimated = false;
let stoppedForCost = false;
let stopReason = null;
const reviews = [];

try {
  for (const key of order) {
    for (let reviewer = 0; reviewer < opts.reviewers; reviewer++) {
      // The cap is checked BEFORE the call: a budget can only be enforced by
      // a call not made.
      const estimate = maxCallUsd > 0 ? maxCallUsd : opts.estimateUsd;
      if (spentUsd + estimate > opts.costCapUsd) {
        stoppedForCost = true;
        stopReason = `cost cap reached: $${spentUsd.toFixed(4)} spent, next call estimated at $${estimate.toFixed(4)}, cap $${opts.costCapUsd.toFixed(2)}`;
        reviews.push({ id: key.id, review: null, unverifiedReason: stopReason });
        break;
      }

      // Materialised even on a dry run: the fake reviewer is the only part a
      // dry run fakes, so the scenario the real reviewer would be handed is
      // built and thrown away rather than skipped.
      const repo = materialise(key.id, join(workdir, `r${reviewer}`));
      const result = opts.dryRun
        ? fakeReviewer(opts, key, fakeScript)
        : callReviewer(opts, contract, repo, systemPrompt, schema, opts.costCapUsd - spentUsd);

      // A call that volunteered no cost is charged the running estimate
      // instead of nothing — including one that errored or timed out, which
      // was billing right up to the moment it died. A cap that only counts
      // what the reviewer chose to report is not a cap: the whole corpus
      // would run past it while `spentUsd` stayed at zero. Only a reviewer
      // that never started spent nothing.
      const reported = typeof result.costUsd === 'number' && result.costUsd > 0;
      const charged = reported ? result.costUsd : result.spawnFailed ? 0 : estimate;
      if (!reported && !result.spawnFailed) spendEstimated = true;
      spentUsd += charged;
      maxCallUsd = Math.max(maxCallUsd, charged);
      reviews.push({
        id: key.id,
        review: result.review,
        ...(result.review === null ? { unverifiedReason: result.reason ?? 'no review produced' } : {}),
      });
      console.log(
        `  ${result.review === null ? 'unverified' : 'reviewed  '}  ${key.id}  ($${charged.toFixed(4)}${reported ? '' : ' est'}, $${spentUsd.toFixed(4)} spent)`,
      );
    }
    if (stoppedForCost) {
      // Everything after the stop is unrun, and unrun is unverified.
      for (const rest of order.slice(order.indexOf(key) + 1)) {
        reviews.push({ id: rest.id, review: null, unverifiedReason: stopReason });
      }
      break;
    }
  }
} finally {
  rmSync(workdir, { recursive: true, force: true });
}

const score = scoreRun(reviews, keys);

const result = {
  schemaVersion: SCHEMA_VERSION,
  runId,
  startedAt,
  trigger: opts.trigger,
  ...(opts.dryRun ? { dryRun: true } : {}),
  config: {
    gitSha: gitSha(),
    cludBugVersion: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
    recipeSha256: createHash('sha256').update(systemPrompt).digest('hex'),
    reviewerModel: opts.model,
    reviewerEffort: opts.effort,
    // Every divergence from the Action's real path travels with the number:
    // the published sentence interpolates this string verbatim, so what is
    // not said here is said nowhere a reader of the score will look.
    invocation: opts.dryRun
      ? 'dry run (no reviewer called)'
      : `${opts.reviewers} headless claude -p pass${opts.reviewers === 1 ? '' : 'es'} per scenario, ` +
        'tools from the shipped workflow template, but no PR context and no `gh`, ' +
        'no inline-comment tool, each module presented as a two-commit local repo',
    reviewersPerScenario: opts.reviewers,
    suite: opts.suite,
    // The template the contract above was read from, not a second pick.
    // Always recorded, never conditional: the seed IS the run order, and an
    // order that is not in the result file cannot be re-run.
    seed: opts.seed,
    workflowTemplate: contract.template,
  },
  cost: {
    capUsd: opts.costCapUsd,
    spentUsd: Math.round(spentUsd * 10000) / 10000,
    spendEstimated,
    stoppedForCost,
    stopReason,
  },
  totals: score.totals,
  scenarios: score.scenarios,
};

function gitSha() {
  const run = spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return run.status === 0 ? run.stdout.trim() : null;
}

mkdirSync(join(outDir, 'history'), { recursive: true });
const serialized = JSON.stringify(result, null, 2) + '\n';
writeFileSync(join(outDir, 'history', `${runId}.json`), serialized);
writeFileSync(join(outDir, 'latest.json'), serialized);

const t = result.totals;
console.log(
  `\nrun-benchmark: caught ${t.caught}/${t.total} (${t.recallPct}%), ` +
    `${t.falsePositives} false flag(s) of ${t.decoysTotal} decoys, ` +
    `${t.unverified} unverified, $${result.cost.spentUsd} of a $${opts.costCapUsd} cap.`,
);
console.log(`run-benchmark: wrote ${join(outDir, 'latest.json')}`);
if (stoppedForCost) console.log(`::warning::run-benchmark: ${stopReason}`);
