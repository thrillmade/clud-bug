import { readFile, writeFile, mkdir, stat, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { renderFile, pickTemplate, templateLanguage } from './render.js';
import { reviewPrompt } from '../dist/core/prompts.js';
import { detect, buildDescriptionLine } from '../dist/core/detect.js';
import { loadBaseline, readManifest, writeManifest } from '../dist/cli/skills.js';
import { applyToRepo as applyAgentDocs } from './agents-md.js';

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
//
// Returns { changed, unchanged, skipped, ourVersion }.
export async function runUpdate({
  cwd,
  templatesDir,
  baselineDir,
  ourVersion,
  refreshRemote = false,
  loadBaselineOpts,    // forwarded to loadBaseline (e.g. for tests: { fetch, cacheDir: null })
} = {}) {
  if (!cwd || !templatesDir || !baselineDir || !ourVersion) {
    throw new Error('runUpdate requires cwd, templatesDir, baselineDir, ourVersion');
  }
  const skillsDir = join(cwd, '.claude', 'skills');
  const manifest = await readManifest(skillsDir);
  if (manifest.installed.length === 0 && !(await pathExists(join(cwd, '.github/workflows/clud-bug-review.yml')))) {
    return { changed: [], unchanged: [], missing: 'init' };
  }

  const changed = [];
  const unchanged = [];
  const skipped = [];

  // 1. Re-render review workflow with the latest template.
  const signals = await detect(cwd);
  const tmplName = pickTemplate(signals.languages);
  // REVIEW_SCHEMA + CCA_VERSION + CLUD_BUG_VERSION come from render.js DEFAULTS.
  const newReview = await renderFile(join(templatesDir, tmplName), {
    REVIEW_PROMPT: reviewPrompt({
      projectDescription: buildDescriptionLine(signals),
      language: templateLanguage(tmplName),
    }),
  });
  await maybeRefreshVersioned(join(cwd, '.github/workflows/clud-bug-review.yml'), newReview, changed, unchanged, skipped, 'review workflow');

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
  const excluded = new Set(Array.isArray(manifest.excludedBaselines) ? manifest.excludedBaselines : []);
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
    strictMode: manifest.strictMode === true,
  });
  for (const p of agentDocs.created) changed.push({ path: join(cwd, p), label: `agent docs: created ${p}` });
  for (const p of agentDocs.touched) changed.push({ path: join(cwd, p), label: `agent docs: ${p}` });

  // 6. Stamp the manifest with the version that ran the update.
  manifest.lastUpdate = new Date().toISOString();
  manifest.lastUpdateVersion = ourVersion;
  await writeManifest(skillsDir, manifest);

  return { changed, unchanged, skipped, ourVersion };
}

async function maybeWrite(path, contents, changed, unchanged, label) {
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
async function maybeRefreshVersioned(path, contents, changed, unchanged, skipped, label) {
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
function extractTemplateVersion(text) {
  if (!text) return null;
  const head = text.split('\n', 5).join('\n');
  const m = head.match(/^# clud-bug-template-version:\s*(\S+)/m);
  return m ? m[1] : null;
}

async function readSafe(path) {
  try { return await readFile(path, 'utf8'); } catch { return null; }
}

async function pathExists(path) {
  try { await stat(path); return true; } catch { return false; }
}

function sanitize(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}
