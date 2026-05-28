#!/usr/bin/env node
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { detect, buildDescriptionLine } from '../lib/detect.js';
import { renderFile, pickTemplate, templateLanguage } from '../lib/render.js';
import { reviewPrompt } from '../lib/prompts.js';
import {
  SkillsClient, rankAndCap, writeSkills, writeSkill, loadBaseline,
  readManifest, writeManifest, removeSkill, listInstalled, diffManifest,
} from '../lib/skills.js';
import { computeAuditFileSet, renderAuditHeader } from '../lib/audit.js';
import { runUpdate } from '../lib/update.js';
import { getPendingWorkflowEdits, makeBranchName, git as gitCmd } from '../lib/edit-workflow.js';
import { applyToRepo as applyAgentDocs } from '../lib/agents-md.js';
import { detectRepo, detectDefaultBranch, getProtectionState, enableConversationResolution } from '../lib/branch-protection.js';

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATES = join(PKG_ROOT, 'templates');
const BASELINE_DIR = join(TEMPLATES, 'skills', 'baseline');

function parseArgs(argv) {
  const args = {
    _: [], offline: false, acceptAll: false, commit: false, help: false, version: false,
    since: null, changedIn: null, scopes: [], out: null,
    setProtection: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--offline') args.offline = true;
    else if (a === '--accept-all' || a === '-y') args.acceptAll = true;
    else if (a === '--commit') args.commit = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else if (a === '--since') args.since = argv[++i];
    else if (a === '--changed-in') args.changedIn = argv[++i];
    else if (a === '--scope') args.scopes.push(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--no-set-protection') args.setProtection = false;
    else args._.push(a);
  }
  return args;
}

const HELP = `clud-bug 🐛 — a field guide to specimens crawling your code

Usage:
  npx clud-bug <command> [options]

Commands:
  init                  Open field season: survey the repo, pin baseline specimens, write the workflows.
  list                  Show your collection (baseline / from skills.sh / custom).
  add <source/name>     Pin one new specimen from skills.sh (e.g. vercel-labs/skills/next-best-practices).
  remove <slug>         Unpin a clud-bug-managed specimen (refuses to touch your custom ones).
  refresh               Re-survey, diff against your collection, prompt to update.
  audit                 Walk the whole habitat (or a recent slice) and prepare a report stub.
                        Use --since / --changed-in / --scope to narrow.
  update                Re-render workflows + refresh baseline specimens to the latest shipped
                        templates. Custom and skills.sh-installed specimens left alone.
  edit-workflow         Helper for editing .github/workflows/clud-bug-*.yml in an isolated
                        PR (the action refuses to review PRs that modify its own workflow).

Options:
  --offline             Skip skills.sh; pin only the bundled baseline specimens.
  --accept-all,-y       Accept the recommended specimens without prompting.
  --commit              git add + commit the generated kit when done (init only).
  --no-set-protection   Skip the prompt that offers to enable
                        required_conversation_resolution on the default
                        branch (init only). Use for repos that manage
                        branch protection via ruleset or org policy.
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

  const cmd = args._[0];
  switch (cmd) {
    case 'init':    return runInit(args);
    case 'list':    return runList(args);
    case 'add':     return runAdd(args);
    case 'remove':  return runRemove(args);
    case 'refresh': return runRefresh(args);
    case 'audit':   return runAudit(args);
    case 'update':  return runUpdateCmd(args);
    case 'edit-workflow': return runEditWorkflow(args);
    default:
      process.stderr.write(`Unknown command: ${cmd || '(none)'}\n\n${HELP}`);
      process.exit(2);
  }
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
  const workflow = await renderFile(tmplPath, {
    REVIEW_PROMPT: reviewPrompt({
      projectDescription: buildDescriptionLine(signals),
      language: templateLanguage(tmplName),
    }),
  });
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

  // Stamp the manifest. Sets strictMode: true ONLY on fresh installs —
  // a manifest that's never been touched by clud-bug init/update has no
  // lastUpdate field. Existing v0.3.x advisory installs (where strictMode
  // was never written and so == undefined) keep their advisory behavior
  // because lastUpdate IS set; the strictMode default only fires on truly
  // fresh inits. Users opt out by setting strictMode: false.
  const skillsDirPath = join(cwd, '.claude', 'skills');
  const manifest = await readManifest(skillsDirPath);
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
      '.github/workflows/clud-bug-review.yml',
      '.github/workflows/clud-bug-audit.yml',
      '.github/workflows/clud-bug-self-update.yml',
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
  log('  1. Set ANTHROPIC_API_KEY in your repo secrets:');
  log('     Settings → Secrets and variables → Actions → New repository secret');
  if (!args.commit) {
    log('  2. git add .claude .github/workflows/clud-bug-*.yml && git commit && git push');
    log('  3. Open a PR — the naturalist arrives within ~2 minutes.');
  } else {
    log('  2. git push, then open a PR — the naturalist arrives within ~2 minutes.');
  }
  log('');
  log('Drop your own .claude/skills/<name>/SKILL.md files anytime — they get pinned automatically.');
  log('For a whole-repo walk: Actions tab → Clud Bug 🐛 Audit → Run workflow.');
  log('Self-update is on (weekly Mondays 12:00 UTC). Pin via "pinVersion" in .claude/skills/.clud-bug.json.');
  log('');
  log('Strict mode is ON by default (clud-bug-review fails the check on critical findings).');
  log('  • Add `clud-bug-review` to your branch protection required checks for full enforcement.');
  log('  • Opt out by setting "strictMode": false in .claude/skills/.clud-bug.json.');
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
}

async function runRefresh(args) {
  const cwd = process.cwd();
  const skillsDir = join(cwd, '.claude', 'skills');
  const manifest = await readManifest(skillsDir);
  if (manifest.installed.length === 0) {
    log('No clud-bug-managed specimens found. Run `clud-bug init` first.');
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
    return;
  }

  const skipped = result.skipped ?? [];

  if (result.changed.length === 0 && skipped.length === 0) {
    log('  Already current. Nothing to update.');
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
    return;
  }

  const outPath = args.out || join(cwd, 'audits', `${date}.md`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, renderAuditHeader({ date, scopeLabel, files }));
  log(`  ✓ wrote stub: ${rel(cwd, outPath)}`);
  log('');
  log('Stub is empty findings — populated by the GitHub Action.');
  log('Run locally without the workflow if you want — Clud Bug review needs the action runner + ANTHROPIC_API_KEY.');
}

function rel(from, to) {
  return to.startsWith(from + '/') ? to.slice(from.length + 1) : to;
}
function log(msg) { process.stdout.write(msg + '\n'); }
function warn(msg) { process.stderr.write(`  ! ${msg}\n`); }

main().catch(err => {
  process.stderr.write(`clud-bug: ${err.message}\n`);
  process.exit(1);
});
