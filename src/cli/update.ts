import { readFile, writeFile, mkdir, stat, rm, chmod, rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { renderFile, pickTemplate, templateLanguage } from '../core/render.js';
import { reviewPrompt } from '../core/prompts.js';
import { detect, buildDescriptionLine } from '../core/detect.js';
import { REGISTRATION_PATHS, isRegistrationPathCommittable } from '../core/attestation.js';
import { loadBaseline, readManifest, writeManifest, type LoadBaselineOptions } from './skills.js';
import { applyToRepo as applyAgentDocs } from './agents-md.js';
import {
  mergeLocalReviewHook, removeLocalReviewHook, buildCommitReviewCommand, CLUD_BUG_HOOK_MARKER,
  buildPrePushHookScript, CLUD_BUG_PREPUSH_MARKER, PREPUSH_HOOK_FILE, PREPUSH_CHAINED_FILE,
  planPrePushInstall, mergeAttestationHooks, ATTESTATION_HOOK_MARKER,
  buildReviewerAgentFile, REVIEWER_AGENT_PATH, REVIEWER_AGENT_MARKER,
  type ClaudeSettings,
} from './hooks.js';

/** Which local-review surface(s) a resolved `review.trigger` names. */
export type ReviewTrigger = 'commit' | 'push' | 'both';

/**
 * #253 residual (ruling 1) — SPEC 2.0 §4.1's precedence for `review.trigger`:
 * once the manifest names one, it is the ONE source of truth for which
 * local-review surface(s) a repo wants. A hook FILE's presence on disk is
 * derived state — consulted only as a fallback guess (`fileTrigger`) when the
 * manifest has never recorded a trigger. `runUpdate`'s reconciliation below
 * and `runInit`'s no-flag fallback (main.ts) both resolve through this one
 * function, so the precedence cannot drift between the two callers the way
 * it did before #253 (a bare `init --with-hooks` re-run trusted the hook
 * FILES alone and silently overwrote a `config set review.trigger` the
 * manifest already held).
 */
export function resolveReviewTrigger(
  manifestTrigger: unknown,
  fileTrigger: ReviewTrigger | null,
): ReviewTrigger | null {
  return manifestTrigger === 'commit' || manifestTrigger === 'push' || manifestTrigger === 'both'
    ? manifestTrigger
    : fileTrigger;
}

/**
 * #253 residual (ruling 1 follow-up, break-it finding) — reconciling the
 * hook FILES to a resolved trigger is not just an ADD problem: switching away
 * from a surface must remove it, not just decline to refresh it. `runUpdate`
 * (below) and `runInit`'s no-flag fallback (main.ts) both resolve the
 * three-way settings.json choice through this one function — add/refresh the
 * commit-review entry when `wantsCommitHook`, strip it when it's present but
 * no longer wanted, else touch only the #266 attestation entries — so the two
 * callers cannot drift on REMOVAL the way `runInit` already drifted on
 * precedence before ruling 1.
 */
export function resolveCommitHookMerge(
  existing: unknown,
  wantsCommitHook: boolean,
  commitHookFilePresent: boolean,
): { merged: ClaudeSettings; label: string } {
  const merged = wantsCommitHook
    ? mergeLocalReviewHook(existing, buildCommitReviewCommand())
    : commitHookFilePresent
      ? removeLocalReviewHook(existing)
      : mergeAttestationHooks(existing);
  const label = wantsCommitHook
    ? 'commit-review + attestation hooks'
    : commitHookFilePresent
      ? 'commit-review hook removed (review.trigger no longer names it) + attestation hooks'
      : 'attestation hooks';
  return { merged, label };
}

/**
 * The pre-push half of the same reconcile-to-trigger step, shared for the
 * same reason: `runUpdate`'s REMOVE branch (below) and `runInit`'s new one
 * (main.ts) both call this rather than each re-implementing "restore a
 * chained foreign hook, or `rm` a hook that's entirely ours" — the same
 * asymmetry that, left ADD-only in `runInit`, was this finding.
 */
export async function removePrePushHookFile(hooksDir: string, prePushPath: string): Promise<void> {
  const chainedPath = join(hooksDir, PREPUSH_CHAINED_FILE);
  let hadChained = false;
  try {
    await stat(chainedPath);
    hadChained = true;
  } catch {
    hadChained = false;
  }
  if (hadChained) {
    await rename(chainedPath, prePushPath);
  } else {
    await rm(prePushPath, { force: true });
  }
}

// Re-render the user's workflow + refresh baseline skills using the
// templates / baseline shipped with the currently-installed clud-bug.
//
// Honors four protections:
//   - Custom skills (anything in .claude/skills/ not in the manifest) are
//     never modified.
//   - Remote skills (from skills.sh, kind: 'remote' in manifest) are left
//     alone unless { refreshRemote: true }.
//   - The audit + self-update workflows are also refreshed if installed.
//   - Markerless workflow files (no `# clud-bug-template-version:` header)
//     are treated as user-customized and left alone — the user gets a
//     printed warning + the documented "delete + clud-bug init" recovery
//     path. Mirrors logmind v0.2.1's refresh-mode pattern.

export interface RunUpdateOptions {
  cwd: string;
  templatesDir: string;
  baselineDir: string;
  ourVersion: string;
  refreshRemote?: boolean | undefined;
  // forwarded to loadBaseline (e.g. for tests: { fetch, cacheDir: null })
  loadBaselineOpts?: LoadBaselineOptions | undefined;
}

export interface UpdateChangeRecord {
  path: string;
  label: string;
  from?: string | undefined;
  to?: string | undefined;
}

export interface UpdateSkippedRecord {
  path: string;
  label: string;
  reason: string;
}

export interface RunUpdateResult {
  changed: UpdateChangeRecord[];
  unchanged: UpdateChangeRecord[];
  skipped?: UpdateSkippedRecord[];
  // #319 — one-line warnings that are neither a file change nor a skip
  // (nothing was written or left alone; a repo-config STATE was noticed).
  // `runUpdate` never prompts for these — it runs unattended in the
  // self-update Action as often as it runs by hand — so a gap it cannot fix
  // itself is reported here for the caller to print, never silently dropped
  // (§6.5) and never blocked on (only `init`'s ask-step, run by a human,
  // resolves it).
  advisories?: string[];
  ourVersion?: string;
  missing?: 'init';
}

// Returns { changed, unchanged, skipped, ourVersion }.
export async function runUpdate(opts: RunUpdateOptions): Promise<RunUpdateResult> {
  const { cwd, templatesDir, baselineDir, ourVersion, refreshRemote = false, loadBaselineOpts } = opts;
  if (!cwd || !templatesDir || !baselineDir || !ourVersion) {
    throw new Error('runUpdate requires cwd, templatesDir, baselineDir, ourVersion');
  }
  const skillsDir = join(cwd, '.claude', 'skills');
  // #271 — a WRITE path: the stamp at the end writes this object back, so a
  // manifest we could not read must stop the run rather than be replaced by a
  // fresh empty one. The throw reaches the CLI, which exits non-zero.
  const manifest = await readManifest(skillsDir, { strict: true });
  if (manifest.installed.length === 0 && !(await pathExists(join(cwd, '.github/workflows/clud-bug-review.yml')))) {
    return { changed: [], unchanged: [], missing: 'init' };
  }

  const changed: UpdateChangeRecord[] = [];
  const unchanged: UpdateChangeRecord[] = [];
  const skipped: UpdateSkippedRecord[] = [];
  const advisories: string[] = [];

  // 1. Re-render the review workflow with the latest template — ONLY if it is
  //    already installed. A `--local-only` (max-mode) repo has no review
  //    workflow and must NOT have one created by `update`: that would
  //    re-introduce the ANTHROPIC_API_KEY Action the local install deliberately
  //    skips (dogfood caught `update` doing exactly this). Mirrors the
  //    pathExists-gating the audit + self-update workflows already use below.
  const reviewPath = join(cwd, '.github/workflows/clud-bug-review.yml');
  if (await pathExists(reviewPath)) {
    const signals = await detect(cwd);
    const tmplName = pickTemplate(signals.languages);
    // REVIEW_SCHEMA + CCA_VERSION + CLUD_BUG_VERSION come from render.js DEFAULTS.
    const newReview = await renderFile(join(templatesDir, tmplName), {
      REVIEW_PROMPT: reviewPrompt({
        projectDescription: buildDescriptionLine(signals),
        language: templateLanguage(tmplName),
      }),
    });
    await maybeRefreshVersioned(reviewPath, newReview, changed, unchanged, skipped, 'review workflow');

    // 1b. The fork-notice workflow is CREATED here, not gated on already
    //     existing like the audit/self-update ones below. It has to be, and the
    //     asymmetry is load-bearing:
    //
    //     Template v15 renamed the review JOB off `clud-bug-review` so the merge
    //     gate has exactly one producer — the API-posted check-run. On a FORK
    //     pull request the review workflow's token is read-only, so it can post
    //     nothing at all; clud-bug-fork-notice.yml (pull_request_target, base
    //     repo context, writable token) is the only surface that can. A repo
    //     that refreshed to v15 WITHOUT gaining this file would have no producer
    //     for fork PRs, and a required `clud-bug-review` would hang unsatisfied
    //     forever — turning a false green into a hard block, which is worse.
    //
    //     It is bound to the review workflow's presence, so a `--local-only`
    //     (max-mode) install still gets no Action workflows.
    const forkNoticePath = join(cwd, '.github/workflows/clud-bug-fork-notice.yml');
    const newForkNotice = await renderFile(join(templatesDir, 'fork-notice.yml.tmpl'), {});
    await maybeRefreshVersioned(forkNoticePath, newForkNotice, changed, unchanged, skipped, 'fork-notice workflow');
  }

  // 2. Re-render audit workflow if it's installed (init from v0.3+ ships it).
  // Routed through renderFile (was raw readFile pre-v0.5.11) so
  // {{CCA_VERSION}} substitution lands in audit alongside review.
  const auditPath = join(cwd, '.github/workflows/clud-bug-audit.yml');
  if (await pathExists(auditPath)) {
    const newAudit = await renderFile(join(templatesDir, 'audit.yml.tmpl'), {});
    await maybeRefreshVersioned(auditPath, newAudit, changed, unchanged, skipped, 'audit workflow');
  }

  // 2b. Re-render self-update workflow if installed (init from v0.4+ ships it).
  // Routed through renderFile for parity — no CCA ref in self-update today
  // but future tokens should propagate uniformly without another refactor.
  const selfUpdatePath = join(cwd, '.github/workflows/clud-bug-self-update.yml');
  if (await pathExists(selfUpdatePath)) {
    const newSelfUpdate = await renderFile(join(templatesDir, 'self-update.yml.tmpl'), {});
    await maybeRefreshVersioned(selfUpdatePath, newSelfUpdate, changed, unchanged, skipped, 'self-update workflow');
  }

  // 3. Refresh baseline skills (always controlled by clud-bug).
  //    Slugs listed in manifest.excludedBaselines are skipped AND their
  //    existing .claude/skills/<slug>/ dir is removed if present, so a repo
  //    that opts out of a baseline doesn't end up regenerating it on every
  //    update (the original symptom this field exists to fix).
  const excludedRaw = manifest['excludedBaselines'];
  const excluded = new Set<string>(Array.isArray(excludedRaw) ? (excludedRaw as string[]) : []);
  const baseline = await loadBaseline(baselineDir, loadBaselineOpts);
  for (const skill of baseline) {
    const slug = sanitize(skill.name);
    if (excluded.has(skill.name) || excluded.has(slug)) {
      const skillDir = join(skillsDir, slug);
      if (await pathExists(skillDir)) {
        await rm(skillDir, { recursive: true, force: true });
        changed.push({ path: skillDir, label: `excluded baseline ${skill.name}: removed` });
      }
      continue;
    }
    const skillPath = join(skillsDir, slug, 'SKILL.md');
    await maybeWrite(skillPath, skill.content, changed, unchanged, `baseline ${skill.name}`);
  }

  // 4. Optionally refresh remote skills (off by default).
  // Custom skills are never touched.
  // (Remote refresh is intentionally minimal here — `clud-bug refresh`
  // already covers add/remove diffs against skills.sh.)
  if (refreshRemote) {
    // Placeholder for parity with the flag; full logic remains in
    // `clud-bug refresh`. We just emit an advisory.
  }

  // 5. Refresh the AGENTS.md / CLAUDE.md clud-bug block. The block embeds
  //    the version + strict-mode state, so an update with a new version
  //    rewrites it. Files that don't already exist (other than AGENTS.md)
  //    are left alone, so this never silently creates instruction stubs.
  // `=== true` mirrors the workflow's gate predicate at
  // templates/workflow*.yml.tmpl. A v0.3 advisory manifest (strictMode
  // undefined, lastUpdate set) renders "off" — matching the gate, not the
  // default-on behavior of fresh v0.4+ installs.
  const agentDocs = await applyAgentDocs(cwd, {
    version: ourVersion,
    strictMode: manifest['strictMode'] === true,
  });
  for (const p of agentDocs.created) changed.push({ path: join(cwd, p), label: `agent docs: created ${p}` });
  for (const p of agentDocs.touched) changed.push({ path: join(cwd, p), label: `agent docs: ${p}` });
  // #253 migration ruling — a file already damaged by the shipped
  // duplicate-append bug (more than one live clud-bug block) was just
  // collapsed to one. `advisories` is this file's channel for a state the
  // caller should print but `update` cannot ask about (it runs unattended).
  for (const p of agentDocs.collapsed) {
    advisories.push(`${p}: found more than one clud-bug block (#253) — collapsed to one, keeping the first.`);
  }

  // 5b. Refresh the local-review slash command (Wave 6b) when it was scaffolded
  //     via `clud-bug init --with-local-review`. Only files carrying the
  //     `<!-- clud-bug-local-version:` marker are refreshed; a markerless file
  //     is user-owned (hand-customized) and left untouched.
  const localReviewPath = join(cwd, '.claude', 'commands', 'clud-bug-review.md');
  if (await pathExists(localReviewPath)) {
    const prior = await readSafe(localReviewPath);
    if (prior && prior.includes('<!-- clud-bug-local-version:')) {
      const newCommand = await renderFile(join(templatesDir, 'clud-bug-review.md.tmpl'), {});
      await maybeWrite(localReviewPath, newCommand, changed, unchanged, 'local-review slash command');
    } else {
      skipped.push({
        path: localReviewPath,
        label: 'local-review slash command',
        reason: 'markerless (user-customized); delete + `clud-bug init --with-local-review` to refresh',
      });
    }
  }

  // Which local review surface(s), if any, this repo has installed on disk.
  const hooksDirResult = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd, encoding: 'utf8' });
  const prePushPath =
    hooksDirResult.status === 0 ? join(cwd, hooksDirResult.stdout.trim(), PREPUSH_HOOK_FILE) : null;
  const priorPrePush = prePushPath ? await readSafe(prePushPath) : undefined;
  const prePushFilePresent = !!priorPrePush && priorPrePush.includes(CLUD_BUG_PREPUSH_MARKER);
  const settingsPath = join(cwd, '.claude', 'settings.json');
  const priorSettings = (await pathExists(settingsPath)) ? await readSafe(settingsPath) : null;
  const commitHookFilePresent = !!priorSettings && priorSettings.includes(CLUD_BUG_HOOK_MARKER);

  // #253 residual / SPEC 2.0 §4.1 + §1.6: `review.trigger` (manifest
  // `reviewTrigger`, written by `init --hook-trigger`, #271's CONFIG_KEYS)
  // is the ONE source of truth for which surface(s) should be installed,
  // once it is set — `update` reconciles the files on disk to it (adding a
  // surface it now names, removing one it no longer does), rather than
  // treating "a hook file happens to exist" as a second, driftable record.
  // Reconciliation only fires for a repo that already has AT LEAST ONE local
  // surface installed: a manifest with `reviewTrigger` set but neither hook
  // ever installed is outside what #253 asked for, and gating this way keeps
  // `update` from turning a bare `config set review.trigger` into the first
  // install of a surface `--with-hooks` was never asked to scaffold. A
  // manifest that has never recorded a trigger (a pre-#253 install) falls
  // back to the original contract below: refresh what's there, add/remove
  // nothing.
  const rawTrigger = manifest['reviewTrigger'];
  const triggerIsSet = rawTrigger === 'commit' || rawTrigger === 'push' || rawTrigger === 'both';
  const canReconcile = triggerIsSet && (commitHookFilePresent || prePushFilePresent);
  // The file-based guess `resolveReviewTrigger` falls back to when the
  // manifest has nothing to say — same two-marker read `detectExistingHookTrigger`
  // (main.ts) makes from hook files, expressed as one ReviewTrigger.
  const fileTrigger: ReviewTrigger | null =
    commitHookFilePresent && prePushFilePresent ? 'both'
    : commitHookFilePresent ? 'commit'
    : prePushFilePresent ? 'push'
    : null;
  const effectiveTrigger = canReconcile ? resolveReviewTrigger(rawTrigger, fileTrigger) : fileTrigger;
  const wantsCommitHook = effectiveTrigger === 'commit' || effectiveTrigger === 'both';
  const wantsPrePushHook = effectiveTrigger === 'push' || effectiveTrigger === 'both';

  // 5c. Reconcile the native commit-review hook (Wave 6b) — refreshed in
  //     place when it's already there and still wanted, ADDED when
  //     `review.trigger` now names it and it isn't there yet, REMOVED when
  //     `review.trigger` no longer names it — plus the #266 attestation
  //     entries. settings.json is user-managed — we only touch OUR marked
  //     hooks, never the user's other hooks/settings.
  const anyLocalSurface =
    commitHookFilePresent || prePushFilePresent || wantsCommitHook || wantsPrePushHook ||
    !!priorSettings?.includes(ATTESTATION_HOOK_MARKER);
  if (anyLocalSurface) {
    try {
      const existing = priorSettings === null ? undefined : JSON.parse(priorSettings);
      const { merged, label } = resolveCommitHookMerge(existing, wantsCommitHook, commitHookFilePresent);
      await mkdir(dirname(settingsPath), { recursive: true });
      await maybeWrite(settingsPath, JSON.stringify(merged, null, 2) + '\n', changed, unchanged, label);
    } catch {
      skipped.push({
        path: settingsPath,
        label: 'commit-review + attestation hooks',
        reason: 'settings.json is not valid JSON; left untouched',
      });
    }

    // The subagent definition the SubagentStop matcher names. Markerless means
    // hand-owned — same rule as the local-review slash command above.
    const agentPath = join(cwd, ...REVIEWER_AGENT_PATH);
    const priorAgent = await readSafe(agentPath);
    if (priorAgent === null || priorAgent.includes(REVIEWER_AGENT_MARKER)) {
      await mkdir(dirname(agentPath), { recursive: true });
      await maybeWrite(agentPath, buildReviewerAgentFile(), changed, unchanged, 'reviewer subagent');
    } else {
      skipped.push({
        path: agentPath,
        label: 'reviewer subagent',
        reason: 'markerless (user-customized); delete it and re-run to refresh',
      });
    }

    // #266 item 1 (SPEC §4.4:961) — same committability check `init` runs
    // right after writing these two files (`main.ts`); `update` retrofits an
    // already-installed repo, so a `.gitignore`d `.claude/` here is just as
    // real a gap, whether this run just wrote the files or found them already
    // in place. `advisories` is the channel this file already uses for a
    // repo-config state `update` cannot fix unattended (see the `#319`
    // comment on `RunUpdateResult.advisories` above) — `update` runs
    // unattended in the self-update Action as often as it runs by hand, so
    // this can only warn, never prompt.
    const notCommittable = REGISTRATION_PATHS.filter((p) => !isRegistrationPathCommittable(cwd, p));
    if (notCommittable.length > 0) {
      advisories.push(
        `${notCommittable.join(', ')}: attestation registration is NOT committable here; reviews ` +
          'from this checkout cannot be certified as independently reviewed until it is committed (SPEC §4.4).',
      );
    }
  }

  // 5d (#276, #253 residual). Reconcile the git `pre-push` review hook the
  //     same three ways: refresh in place, add, or remove. `update` never
  //     installs a surface a pre-#253 repo never opted into (`canReconcile`
  //     above stays false for those, so `wantsPrePushHook` just mirrors file
  //     presence — the original SPEC 2.0 §4.1 contract).
  if (prePushPath) {
    if (wantsPrePushHook && !prePushFilePresent) {
      // ADD — mirrors `main.ts`'s own `installPrePushHook`: same decision
      // (`planPrePushInstall`, hooks.ts — the one place that owns it), this
      // just performs it. Never clobbers a foreign hook; chains to one
      // instead, exactly as `init` would.
      const hooksDir = dirname(prePushPath);
      let chainedExists = false;
      try {
        await stat(join(hooksDir, PREPUSH_CHAINED_FILE));
        chainedExists = true;
      } catch {
        chainedExists = false;
      }
      const prePushScript = buildPrePushHookScript();
      const plan = planPrePushInstall({ existing: priorPrePush ?? undefined, chainedExists, script: prePushScript });
      if (plan.action === 'skip') {
        skipped.push({ path: prePushPath, label: 'pre-push review hook', reason: plan.reason });
      } else {
        await mkdir(hooksDir, { recursive: true });
        if (plan.action === 'chain' && plan.moveExistingTo) {
          await rename(prePushPath, join(hooksDir, plan.moveExistingTo));
        }
        await writeFile(prePushPath, plan.content ?? prePushScript);
        await chmod(prePushPath, 0o755);
        changed.push({
          path: prePushPath,
          label: `pre-push review hook installed (review.trigger now names it — ${plan.reason})`,
        });
      }
    } else if (!wantsPrePushHook && prePushFilePresent) {
      // REMOVE — restore a chained foreign hook if `init` preserved one;
      // otherwise the file is entirely ours, so it goes.
      await removePrePushHookFile(dirname(prePushPath), prePushPath);
      changed.push({ path: prePushPath, label: 'pre-push review hook removed (review.trigger no longer names it)' });
    } else if (prePushFilePresent) {
      await maybeWrite(prePushPath, buildPrePushHookScript(), changed, unchanged, 'pre-push review hook');
      // A refresh must not silently drop the executable bit — git skips a
      // non-executable hook without a word, which is the silent-degradation
      // failure §6.5 exists to forbid.
      try {
        await chmod(prePushPath, 0o755);
      } catch {
        skipped.push({
          path: prePushPath,
          label: 'pre-push review hook',
          reason: 'could not restore the executable bit; git will skip the hook until you chmod +x it',
        });
      }
    }
    // #319 — the mechanical gate this hook now runs BLOCKS a push with no
    // "tests" declaration (SPEC 6.7). `update` never prompts (it runs
    // unattended in the self-update Action), so it can only warn — the
    // fix is `clud-bug init`'s interactive ask-step, or `config set`.
    if (wantsPrePushHook && manifest['tests'] === undefined) {
      advisories.push(
        'no "tests" declared in .claude/skills/.clud-bug.json — SPEC 6.7: the installed pre-push ' +
        'hook now BLOCKS a push with no declaration. Run `clud-bug init` to be asked for one, or ' +
        '`clud-bug config set tests "<command>"` (or `clud-bug config set tests none`).',
      );
    }
  }

  // 6. Stamp the manifest with the version that ran the update.
  manifest['lastUpdate'] = new Date().toISOString();
  manifest['lastUpdateVersion'] = ourVersion;
  await writeManifest(skillsDir, manifest);

  return { changed, unchanged, skipped, advisories, ourVersion };
}

async function maybeWrite(
  path: string,
  contents: string,
  changed: UpdateChangeRecord[],
  unchanged: UpdateChangeRecord[],
  label: string,
): Promise<void> {
  const prior = await readSafe(path);
  if (prior === contents) {
    unchanged.push({ path, label });
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  changed.push({ path, label });
}

// Refresh a versioned template (one that carries `# clud-bug-template-version:`
// on line 1). If the installed file lacks that marker, treat it as
// user-customized and leave it alone — recovery path is delete + `clud-bug init`.
// Mirrors logmind v0.2.1's refresh-mode contract.
async function maybeRefreshVersioned(
  path: string,
  contents: string,
  changed: UpdateChangeRecord[],
  unchanged: UpdateChangeRecord[],
  skipped: UpdateSkippedRecord[],
  label: string,
): Promise<void> {
  const tmplVersion = extractTemplateVersion(contents);
  if (!tmplVersion) {
    // Defensive: every versioned template is supposed to carry a marker.
    // Falling back to byte-compare write here would silently mass-overwrite
    // every installed file (including marker-bearing ones) the moment a
    // future template regressed — the inverse of the protection contract
    // this function exists to enforce. Throw so the regression surfaces
    // in CI instead.
    throw new Error(`Template for ${label} has no # clud-bug-template-version marker — refusing to refresh (templates must declare a marker so refresh-mode can reason about ownership).`);
  }
  const prior = await readSafe(path);
  if (prior === null) {
    // First time writing here; nothing to preserve.
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
    changed.push({ path, label });
    return;
  }
  const priorVersion = extractTemplateVersion(prior);
  if (priorVersion === null) {
    // Markerless installed file = customized. Preserve and warn.
    skipped.push({
      path,
      label,
      reason: 'markerless (user-customized); delete the file + run `clud-bug init` to refresh',
    });
    return;
  }
  if (prior === contents) {
    unchanged.push({ path, label });
    return;
  }
  // Marker present (current or stale) AND content drifted: refresh.
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  changed.push({ path, label, from: priorVersion, to: tmplVersion });
}

// Extract the template-version marker. Templates put it on line 1, but
// scan the first 5 lines so a leading blank or stray header doesn't hide it.
// Anchoring near the top means a stray `# clud-bug-template-version:` lower
// in the file (in a comment inside a heredoc, say) can't be mistaken for the
// authoritative marker. Returns null if not present.
function extractTemplateVersion(text: string | null | undefined): string | null {
  if (!text) return null;
  const head = text.split('\n', 5).join('\n');
  const m = head.match(/^# clud-bug-template-version:\s*(\S+)/m);
  // m[1] is `string | undefined` under noUncheckedIndexedAccess; coalesce
  // to null to keep the return type tight.
  return m ? (m[1] ?? null) : null;
}

async function readSafe(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf8'); } catch { return null; }
}

async function pathExists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

function sanitize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}
