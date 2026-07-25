// Tests for src/cli/review-prompt.ts — `renderReviewRecipe`, the plan-aware
// local-review recipe the `clud-bug review-prompt` verb emits (the dynamic,
// planReview-driven counterpart of the rc.11 static slash-command prompt).

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { planReview } from '../src/core/plan-review.js';
import { renderReviewRecipe, CLUD_BUG_RECIPE_MARKER } from '../src/cli/review-prompt.js';

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bin', 'clud-bug.js');

function makeSkill(slug, review_mode = 'shared') {
  return {
    slug,
    frontmatter: { name: slug, description: `Test ${slug}`, source: 'manual', review_mode },
  };
}

const SKILLS = [
  makeSkill('critical-issues-only'),
  makeSkill('evidence-based-review'),
  makeSkill('respect-existing-conventions'),
];
const MULTIPASS_CONFIG = { count: 3, mode: 'consensus' };

describe('renderReviewRecipe', () => {
  it('emits a commit recipe: marker, single fast pass, reviews HEAD, lists the skills, §1.8.1 format', () => {
    const plan = planReview({ skills: SKILLS, config: MULTIPASS_CONFIG, trigger: 'commit' });
    const recipe = renderReviewRecipe({ plan, trigger: 'commit' });

    expect(recipe).toContain(CLUD_BUG_RECIPE_MARKER);
    // commit → reviews the just-made commit's diff
    expect(recipe).toMatch(/git show[^\n]*HEAD/);
    // every resolved skill is named so the agent loads it
    for (const s of SKILLS) expect(recipe).toContain(s.slug);
    // commit tiers down to ONE pass — no multi-agent fan-out language
    expect(recipe).not.toMatch(/dispatch \d+ reviewer/i);
    // the clud-bug §1.8.1 review body shape
    expect(recipe).toMatch(/Clud Bug review/i);
  });

  it('emits a multi-pass recipe on a pr trigger: fan-out to N sub-agents + the aggregation mode + the tiers', () => {
    const plan = planReview({ skills: SKILLS, config: MULTIPASS_CONFIG, trigger: 'pr' });
    const recipe = renderReviewRecipe({ plan, trigger: 'pr' });

    // pr keeps the full 3-pass plan → instructs dispatching reviewer sub-agents
    expect(recipe).toMatch(/dispatch 3 reviewer/i);
    // names the aggregation mode resolved by the plan
    expect(recipe).toMatch(/consensus/i);
    // names the role tiers (Beetle/Wasp/Mantis) so each pass binds a model
    expect(recipe).toMatch(/beetle/i);
    expect(recipe).toMatch(/wasp/i);
    // pr reviews the branch against its base (not a single commit)
    expect(recipe).toMatch(/gh pr diff|origin\//);
    // H3: a PR recipe posts the self-attested merge-gate check
    expect(recipe).toMatch(/post-check-run --sha/);
    expect(recipe).toMatch(/--source local/);
  });

  it('H3: the merge-gate step is PR-only — a commit recipe never posts a check', () => {
    const plan = planReview({ skills: SKILLS, config: MULTIPASS_CONFIG, trigger: 'commit' });
    const recipe = renderReviewRecipe({ plan, trigger: 'commit' });
    expect(recipe).not.toMatch(/post-check-run/);
  });

  it('carries the plan summary so the operator sees what was resolved', () => {
    const plan = planReview({ skills: SKILLS, config: MULTIPASS_CONFIG, trigger: 'commit' });
    const recipe = renderReviewRecipe({ plan, trigger: 'commit' });
    expect(recipe).toContain(plan.summary);
  });

  it('describes the conditional 3rd Mantis arbiter for a 2-pass cross-check (6c), and omits it otherwise', () => {
    // 2-pass cross-check on a pr → the arbiter escalation prose appears.
    const ccPlan = planReview({
      skills: SKILLS,
      config: { count: 2, mode: 'cross-check' },
      trigger: 'pr',
    });
    const ccRecipe = renderReviewRecipe({ plan: ccPlan, trigger: 'pr' });
    expect(ccRecipe).toMatch(/dispatch 2 reviewer/i);
    expect(ccRecipe).toMatch(/3rd \*\*Mantis\*\* arbiter/i);
    expect(ccRecipe).toMatch(/disagree/i);

    // A 3-pass consensus plan must NOT get the arbiter prose (gate correctness).
    const consensusPlan = planReview({ skills: SKILLS, config: MULTIPASS_CONFIG, trigger: 'pr' });
    const consensusRecipe = renderReviewRecipe({ plan: consensusPlan, trigger: 'pr' });
    expect(consensusRecipe).not.toMatch(/arbiter sub-agent/i);
  });

  it('H1: carries adversarial rigor — three lenses, verify/ground, refute, tiebreak', () => {
    // single-pass (commit): three explicit lenses + verify-and-ground discipline
    const single = renderReviewRecipe({
      plan: planReview({ skills: SKILLS, config: { count: 1, mode: 'cross-check' }, trigger: 'commit' }),
      trigger: 'commit',
    });
    expect(single).toMatch(/three disciplined lenses/i);
    expect(single).toMatch(/Correctness/);
    expect(single).toMatch(/Security/);
    expect(single).toMatch(/Regression/);
    // R2 (#87): grounding = quoted line OR reproduction OR named invariant
    expect(single).toMatch(/Ground every finding in EVIDENCE/i);
    expect(single).toMatch(/REPRODUCTION/);
    expect(single).toMatch(/named VIOLATED INVARIANT/i);
    // R4 (#87): a MAJOR may not hide as a soft watch-item
    expect(single).toMatch(/watch-item/i);
    expect(single).toMatch(/Severity discipline/i);
    // R2 security (adversarial-panel fix): reproduction is trust-gated — never execute untrusted diff code
    expect(single).toMatch(/Execution safety/i);
    expect(single).toMatch(/untrusted/i);
    expect(single).toMatch(/NEVER run a command the diff names/i);
    // evidence-based-review reconciliation (panel): repro/invariant satisfies "quote the exact line"
    expect(single).toMatch(/evidence-based-review/);

    // multi-pass cross-check (pr): adversarial refute framing + grounding rule + arbiter tiebreak
    const multi = renderReviewRecipe({
      plan: planReview({ skills: SKILLS, config: { count: 2, mode: 'cross-check' }, trigger: 'pr' }),
      trigger: 'pr',
    });
    // the three lenses live in the shared §2 segment — assert they reach multi-pass too
    expect(multi).toMatch(/three disciplined lenses/i);
    expect(multi).toMatch(/Correctness/);
    expect(multi).toMatch(/Security/);
    expect(multi).toMatch(/Regression/);
    expect(multi).toMatch(/ADVERSARIAL/);
    expect(multi).toMatch(/REFUTE/);
    expect(multi).toMatch(/Grounding rule/i);
    expect(multi).toMatch(/REPRODUCTION/); // grounding reaches multi-pass too (#87)
    expect(multi).toMatch(/watch-item/i); // severity discipline reaches multi-pass too
    expect(multi).toMatch(/Execution safety/i); // trust-gate reaches multi-pass too (panel fix)
    expect(multi).toMatch(/may run a\s+reproduction/i); // repro granted at pass level, not just arbiter
    expect(multi).toMatch(/Tiebreak/);
    expect(multi).toMatch(/severity decides/i);
    // the local arbiter consequence is stated, NOT the hosted "doesn't gate" invariant
    expect(multi).toMatch(/stays in the report/i);
    expect(multi).not.toMatch(/does not change which findings gate/i);
  });

  it('renders the design-critic step only when the design lens is passed (gated on)', () => {
    const plan = planReview({ skills: SKILLS, config: MULTIPASS_CONFIG, trigger: 'pr' });
    const design = {
      skills: ['visual-polish', 'frontend-a11y'],
      config: { enabled: true, gate: 'advisory', themes: ['light', 'dark'], viewports: ['desktop'] },
    };

    const withDesign = renderReviewRecipe({ plan, trigger: 'pr', design });
    expect(withDesign).toMatch(/## 3b\. Design-critic/);
    expect(withDesign).toMatch(/visual-polish/);
    expect(withDesign).toMatch(/frontend-a11y/);
    expect(withDesign).toMatch(/light \+ dark/);
    expect(withDesign).toMatch(/Advisory/);
    // preview-URL lookup must use gh's {owner}/{repo} placeholders (self-resolved
    // from the cwd repo), NOT unset $OWNER/$REPO shell vars that would neuter the
    // whole pass in local mode.
    expect(withDesign).toMatch(/repos\/\{owner\}\/\{repo\}\/deployments/);
    expect(withDesign).not.toMatch(/\$OWNER|\$REPO/);

    // strict gate flips the wording to merge-blocking
    const strict = renderReviewRecipe({
      plan,
      trigger: 'pr',
      design: { ...design, config: { ...design.config, gate: 'strict' } },
    });
    expect(strict).toMatch(/blocks the merge/);

    // no design arg → no design step at all
    const withoutDesign = renderReviewRecipe({ plan, trigger: 'pr' });
    expect(withoutDesign).not.toMatch(/Design-critic/);
  });

  it('§5 (ZP2, default-on notary): renders ONLY the notary-submit form when notaryUrl resolves, ONLY the self-attest form when it does not, and never the agent-inference env-var language', () => {
    const plan = planReview({ skills: SKILLS, config: MULTIPASS_CONFIG, trigger: 'pr' });

    const withNotary = renderReviewRecipe({ plan, trigger: 'pr', notaryUrl: 'https://app.cludbug.dev' });
    expect(withNotary).toMatch(/notary-enabled/i);
    expect(withNotary).toMatch(/certifying via `https:\/\/app\.cludbug\.dev`/);
    expect(withNotary).toMatch(/--bundle bundle\.json/);
    expect(withNotary).not.toMatch(/opted out of notarization/i);
    expect(withNotary).not.toMatch(/--verdict <clean\|critical\|unverified> --critical-count <N> --source local/);

    const selfAttest = renderReviewRecipe({ plan, trigger: 'pr', notaryUrl: null });
    expect(selfAttest).toMatch(/opted out of notarization/i);
    expect(selfAttest).toMatch(/--verdict <clean\|critical\|unverified> --critical-count <N> --source local/);
    expect(selfAttest).not.toMatch(/notary-enabled/i);
    expect(selfAttest).not.toMatch(/--bundle bundle\.json/);

    // §5 must render deterministically from the caller-resolved value — never
    // ask the agent to infer notary status from the env var itself.
    expect(withNotary).not.toMatch(/CLUD_BUG_NOTARY_URL/);
    expect(selfAttest).not.toMatch(/CLUD_BUG_NOTARY_URL/);

    // Both forms still keep the shared certify-honestly framing.
    for (const recipe of [withNotary, selfAttest]) {
      expect(recipe).toMatch(/## 5\. Certify the review/);
      expect(recipe).toMatch(/Never post `clean` on a change you did not actually verify/);
    }
  });

  it('#240 vector 2: renders the automatic --no-verify finding only when noVerifyFlagged is set', () => {
    const plan = planReview({ skills: SKILLS, config: MULTIPASS_CONFIG, trigger: 'commit' });

    const flagged = renderReviewRecipe({ plan, trigger: 'commit', noVerifyFlagged: true });
    expect(flagged).toMatch(/## 0\. Automatic finding — `--no-verify` bypass/);
    expect(flagged).toMatch(/bypassing whatever git hooks this repo mandates/i);
    expect(flagged).toMatch(/severity`: `critical`/);
    expect(flagged).toMatch(/grounding_kind`: `invariant`/);
    // never a hard-deny — it's a finding to surface, not a block
    expect(flagged).toMatch(/never hard-deny or block the commit over it/i);

    const unflagged = renderReviewRecipe({ plan, trigger: 'commit' });
    expect(unflagged).not.toMatch(/--no-verify/);
    expect(unflagged).not.toMatch(/Automatic finding/);
  });

  it('#239: targetSha renders `git show <sha>` for a pending-drain recipe instead of always HEAD', () => {
    const plan = planReview({ skills: SKILLS, config: MULTIPASS_CONFIG, trigger: 'commit' });
    const sha = 'deadbeefcafe0123456789abcdef0123456789ab';

    const withSha = renderReviewRecipe({ plan, trigger: 'commit', targetSha: sha });
    expect(withSha).toMatch(new RegExp(`git show[^\\n]*${sha}`));
    expect(withSha).not.toMatch(/git show[^\n]*HEAD/);
    expect(withSha).toMatch(/queued commit/i);

    // no targetSha → unchanged default (still reviews HEAD, "commit you just made")
    const withoutSha = renderReviewRecipe({ plan, trigger: 'commit' });
    expect(withoutSha).toMatch(/git show[^\n]*HEAD/);
    expect(withoutSha).not.toMatch(/queued commit/i);
  });

  it('renders the invariant-probe step (§3c) only when probes are passed (R6, #87)', () => {
    const plan = planReview({ skills: SKILLS, config: MULTIPASS_CONFIG, trigger: 'pr' });
    const withProbes = renderReviewRecipe({
      plan,
      trigger: 'pr',
      probes: {
        invariants: [
          { name: 'byte-parity', appliesTo: ['docs/**', 'templates/**'], probe: 'npm run render:check', expect: 'no diff vs golden' },
          { name: 'no-token-push', appliesTo: ['.github/**'], probe: 'grep -rq X .github' },
        ],
      },
    });
    expect(withProbes).toMatch(/## 3c\. Invariant probes/);
    expect(withProbes).toMatch(/byte-parity/);
    expect(withProbes).toMatch(/npm run render:check/);
    expect(withProbes).toMatch(/no diff vs golden/); // expect rendered when present
    expect(withProbes).toMatch(/no-token-push/);
    expect(withProbes).toMatch(/execution-safety/i); // never run an untrusted diff
    expect(withProbes).toMatch(/unverified/); // ties to the R3 verdict

    // no probes arg → no §3c
    const noProbes = renderReviewRecipe({ plan, trigger: 'pr' });
    expect(noProbes).not.toMatch(/## 3c\. Invariant probes/);
  });
});

describe('review-prompt verb (integration)', () => {
  it('loads the manifest + skill frontmatter and prints a recipe', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clud-bug-rp-'));
    const skillsDir = join(dir, '.claude', 'skills');
    await mkdir(join(skillsDir, 'critical-issues-only'), { recursive: true });
    await writeFile(
      join(skillsDir, '.clud-bug.json'),
      JSON.stringify({
        version: 1,
        installed: [
          {
            slug: 'critical-issues-only',
            name: 'critical-issues-only',
            source: 'manual',
            kind: 'baseline',
            description: 'x',
          },
        ],
      }),
    );
    await writeFile(
      join(skillsDir, 'critical-issues-only', 'SKILL.md'),
      '---\nname: critical-issues-only\ndescription: x\nsource: manual\nreview_mode: shared\n---\n\nrules',
    );

    const r = spawnSync(process.execPath, [CLI, 'review-prompt', '--trigger', 'commit'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(CLUD_BUG_RECIPE_MARKER);
    expect(r.stdout).toMatch(/git show[^\n]*HEAD/);
    expect(r.stdout).toContain('critical-issues-only');
  });

  it('honors a SKILL.md review_passes override on a pr trigger (rawSkillMd forwarded)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clud-bug-rp2-'));
    const skillsDir = join(dir, '.claude', 'skills');
    await mkdir(join(skillsDir, 'deep-skill'), { recursive: true });
    await writeFile(
      join(skillsDir, '.clud-bug.json'),
      JSON.stringify({
        version: 1,
        installed: [
          { slug: 'deep-skill', name: 'deep-skill', source: 'manual', kind: 'baseline', description: 'x' },
        ],
      }),
    );
    // The skill author asks for a 3-pass consensus review via SKILL.md frontmatter
    // (precedence layer 2) — this only lands if runReviewPrompt forwards rawSkillMd.
    await writeFile(
      join(skillsDir, 'deep-skill', 'SKILL.md'),
      '---\nname: deep-skill\ndescription: x\nsource: manual\nreview_mode: shared\nreview_passes:\n  count: 3\n  mode: consensus\n---\n\nrules',
    );

    const r = spawnSync(process.execPath, [CLI, 'review-prompt', '--trigger', 'pr'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Dispatch 3 reviewer/i);
  });

  it('warns on an unrecognized --trigger and falls back to a commit recipe', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clud-bug-rp3-'));
    const skillsDir = join(dir, '.claude', 'skills');
    await mkdir(skillsDir, { recursive: true });
    await writeFile(join(skillsDir, '.clud-bug.json'), JSON.stringify({ version: 1, installed: [] }));

    const r = spawnSync(process.execPath, [CLI, 'review-prompt', '--trigger', 'bogus'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/unrecognized --trigger/i);
    expect(r.stdout).toMatch(/git show[^\n]*HEAD/);
  });

  // ZP2: local max mode certifies via the hosted notary by DEFAULT — no
  // `.clud-bug.json` config and no CLUD_BUG_NOTARY_URL override still yields
  // the notary-submit form of §5, not the pre-ZP2 opt-in self-attest-only.
  it('ZP2: a pr-trigger recipe defaults to the notary-submit form of §5 (no config, no env override)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clud-bug-rp4-'));
    const skillsDir = join(dir, '.claude', 'skills');
    await mkdir(skillsDir, { recursive: true });
    await writeFile(join(skillsDir, '.clud-bug.json'), JSON.stringify({ version: 1, installed: [] }));

    // Explicitly unset the override so this test can't accidentally pass
    // (or fail) depending on the outer shell's environment.
    const { CLUD_BUG_NOTARY_URL: _unused, ...envWithoutOverride } = process.env;
    const r = spawnSync(process.execPath, [CLI, 'review-prompt', '--trigger', 'pr'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30000,
      env: envWithoutOverride,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/notary-enabled/i);
    expect(r.stdout).toMatch(/certifying via `https:\/\/app\.cludbug\.dev`/);
    expect(r.stdout).toMatch(/--bundle bundle\.json/);
    expect(r.stdout).not.toMatch(/opted out of notarization/i);
  });

  it('ZP2: `"notary": false` in .clud-bug.json opts the pr-trigger recipe out to the self-attest form of §5', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clud-bug-rp5-'));
    const skillsDir = join(dir, '.claude', 'skills');
    await mkdir(skillsDir, { recursive: true });
    await writeFile(
      join(skillsDir, '.clud-bug.json'),
      JSON.stringify({ version: 1, installed: [], notary: false }),
    );

    // Even with an env override present, the repo's explicit opt-out wins.
    const r = spawnSync(process.execPath, [CLI, 'review-prompt', '--trigger', 'pr'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, CLUD_BUG_NOTARY_URL: 'https://staging.example.com' },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/opted out of notarization/i);
    expect(r.stdout).toMatch(/--verdict <clean\|critical\|unverified> --critical-count <N> --source local/);
    expect(r.stdout).not.toMatch(/notary-enabled/i);
    expect(r.stdout).not.toMatch(/--bundle bundle\.json/);
  });

  // #240 vector 2 — `repoHasMandatedHooks` gates the finding on repo state
  // (`.logmind/` or an AGENTS.md mentioning "hook"), never on the flag alone,
  // so a repo with no such policy never sees a false alarm from --flag-no-verify.
  it('#240 vector 2: --flag-no-verify renders the finding when the repo has a .logmind/ dir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clud-bug-rp6-'));
    const skillsDir = join(dir, '.claude', 'skills');
    await mkdir(skillsDir, { recursive: true });
    await writeFile(join(skillsDir, '.clud-bug.json'), JSON.stringify({ version: 1, installed: [] }));
    await mkdir(join(dir, '.logmind'), { recursive: true });

    const r = spawnSync(process.execPath, [CLI, 'review-prompt', '--trigger', 'commit', '--flag-no-verify'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Automatic finding — `--no-verify` bypass/);
  });

  it('#240 vector 2: --flag-no-verify renders the finding when AGENTS.md mentions "hook"', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clud-bug-rp7-'));
    const skillsDir = join(dir, '.claude', 'skills');
    await mkdir(skillsDir, { recursive: true });
    await writeFile(join(skillsDir, '.clud-bug.json'), JSON.stringify({ version: 1, installed: [] }));
    await writeFile(join(dir, 'AGENTS.md'), '# AGENTS\n\nUse `logmind log` — see the decision-logging hook.\n');

    const r = spawnSync(process.execPath, [CLI, 'review-prompt', '--trigger', 'commit', '--flag-no-verify'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Automatic finding — `--no-verify` bypass/);
  });

  it('#240 vector 2: --flag-no-verify is a NO-OP (no false alarm) when the repo declares no mandated hooks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clud-bug-rp8-'));
    const skillsDir = join(dir, '.claude', 'skills');
    await mkdir(skillsDir, { recursive: true });
    await writeFile(join(skillsDir, '.clud-bug.json'), JSON.stringify({ version: 1, installed: [] }));
    // No .logmind/, no AGENTS.md at all.

    const r = spawnSync(process.execPath, [CLI, 'review-prompt', '--trigger', 'commit', '--flag-no-verify'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/Automatic finding/);
    expect(r.stdout).not.toMatch(/--no-verify/);
  });

  it('without --flag-no-verify, the finding never renders even in a mandated-hooks repo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clud-bug-rp9-'));
    const skillsDir = join(dir, '.claude', 'skills');
    await mkdir(skillsDir, { recursive: true });
    await writeFile(join(skillsDir, '.clud-bug.json'), JSON.stringify({ version: 1, installed: [] }));
    await mkdir(join(dir, '.logmind'), { recursive: true });

    const r = spawnSync(process.execPath, [CLI, 'review-prompt', '--trigger', 'commit'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/Automatic finding/);
  });
});
