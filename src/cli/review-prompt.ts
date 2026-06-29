// `clud-bug review-prompt` — emits the local-review RECIPE: a highly-structured
// prompt the in-session Claude Code agent (or a `type: agent` hook) runs to
// review the current diff, on the session's own subscription. It is the dynamic,
// planReview-driven counterpart of the rc.11 static slash-command prompt: the
// recipe is rendered FROM the shared engine (`core/planReview`), so a commit
// gets a single fast pass and a PR gets the full multi-pass plan — clud-bug
// writes the recipe, Claude Code's subagent is the runtime.

import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

import {
  planReview,
  roleForPass,
  readReviewPassesConfig,
  readDesignConfig,
  shouldRunDesign,
  parseFrontmatter,
  type ReviewPlan,
  type ReviewPlanSkill,
  type ReviewTrigger,
  type ReviewPassMode,
  type DesignConfig,
} from '../core/index.js';
import { readManifest } from './skills.js';

/** Marker that identifies a clud-bug local-review recipe (idempotency + hook detection). */
export const CLUD_BUG_RECIPE_MARKER = 'clud-bug-local-review';

const MODE_AGGREGATION: Record<ReviewPassMode, string> = {
  'cross-check':
    "Pass 1 (broad scan) reviews the diff against all the skills — optimize for recall, surface every " +
    "candidate. Each later pass is ADVERSARIAL: re-read the diff and try to REFUTE pass 1's findings — " +
    "for each, ask 'can I prove this is a false positive, already handled elsewhere, or not actually in " +
    "this diff?' Keep only findings that survive refutation, record an explicit agree/disagree verdict " +
    "per finding, and add any real issues pass 1 missed. Skepticism is the job — do not just confirm.",
  consensus:
    'Run all passes independently against all the skills, each attacking the diff from a different angle. ' +
    'Then keep only findings two or more passes independently land on; a finding only one pass sees is ' +
    'dropped (or downgraded to a note). This trades recall for precision.',
  independent:
    'Run all passes independently against all the skills, each from a distinct lens, then take the union ' +
    'of their findings (attributed to its pass) — but drop any that a quick adversarial re-read refutes.',
};

const TRIGGER_INTRO: Record<ReviewTrigger, string> = {
  commit: 'a fast review of the commit you just made',
  push: 'a review of the branch you are about to push',
  pr: "a review of this branch's open PR",
};

/**
 * Render the local-review recipe from a resolved plan. Pure — all I/O (loading
 * skills + config) happens in `runReviewPrompt`; this turns a `ReviewPlan` into
 * the prompt text. The number of passes, the aggregation mode, the role tiers,
 * and the skills all come from the plan, so the recipe scales from a single
 * fast commit pass up to the full multi-pass PR review without branching here.
 */
export function renderReviewRecipe(input: {
  plan: ReviewPlan;
  trigger: ReviewTrigger;
  /**
   * Design-critic lens (rc.15). Present only when the caller's gate passed
   * (`shouldRunDesign`): the repo opted in, `kind: design` skills are installed,
   * and this is a `pr` trigger. Renders the optional visual-review step.
   */
  design?: { skills: string[]; config: DesignConfig };
}): string {
  const { plan, trigger, design } = input;
  const slugs = plan.perSkill.map((p) => p.slug);
  const maxPasses = plan.perSkill.length
    ? Math.max(...plan.perSkill.map((p) => p.count))
    : 1;
  // Use the aggregation mode of the skill that drives the pass depth, not just
  // the first skill (which may be configured for a single pass).
  const mode: ReviewPassMode =
    plan.perSkill.find((p) => p.count === maxPasses)?.mode ?? 'cross-check';

  const diffStep =
    trigger === 'commit'
      ? 'The commit you just made:\n\n```bash\ngit show --no-color --format=medium HEAD\n```'
      : 'If an open PR exists for this branch, review it; otherwise diff the branch against its base:\n\n' +
        '```bash\n' +
        'PR=$(gh pr list --head "$(git branch --show-current)" --state open --json number --jq \'.[0].number\')\n' +
        'if [ -n "$PR" ]; then\n' +
        '  gh pr diff "$PR"\n' +
        'else\n' +
        '  git remote set-head origin --auto >/dev/null 2>&1 || true  # make sure origin/HEAD resolves\n' +
        '  git diff --no-color origin/HEAD...HEAD\n' +
        'fi\n' +
        '```';

  const skillsList =
    slugs.length > 0
      ? slugs.map((s) => `  - \`.claude/skills/${s}/SKILL.md\``).join('\n')
      : '  - (no skills resolved — apply the baseline discipline below)';

  let reviewStep: string;
  if (maxPasses <= 1) {
    reviewStep =
      'Review the diff against the three lenses above in a single pass. VERIFY before you record: ' +
      'quote the exact offending line from the diff and confirm the `line` number matches that ' +
      'quote — if you cannot ground a finding in a line you actually see in this diff, DROP it ' +
      '(default to silence over a false positive). Record `file`, `line`, `severity` (`critical` | ' +
      '`minor` | `preexisting`), the `skill`, and a one-line `summary`. Finding nothing is the ' +
      'normal, common outcome — be precise, not exhaustive.';
  } else {
    const passLines = Array.from({ length: maxPasses }, (_, i) => {
      const role = roleForPass(plan.roles, i, 'Reviewer');
      const tier = role.tier ? ` · ${role.tier} tier` : '';
      return `  ${i + 1}. **${role.name}**${tier}`;
    }).join('\n');
    // 6c: a 2-pass cross-check escalates to a conditional 3rd Mantis arbiter
    // only when the first two passes disagree on a gate-relevant finding. Gate
    // the prose to the same shape as `shouldEscalate` (cross-check + exactly 2
    // passes) so a 3-pass or consensus plan doesn't get redundant instructions.
    // Resolve the arbiter by tier (not positional index) so a custom <3-role
    // `roles` config can't make `roleForPass`'s modulo wrap name a fast tier as
    // the opus-class arbiter. Falls back to the canonical name when no mantis
    // tier is configured.
    const arbiter = plan.roles.find((r) => r.tier === 'mantis')?.name ?? 'Mantis';
    const escalation =
      mode === 'cross-check' && maxPasses === 2
        ? `\n\nIf passes 1 and 2 **disagree** on any \`critical\` or \`minor\` finding, dispatch a ` +
          `3rd **${arbiter}** arbiter sub-agent (opus-class, read-only tools) that re-examines ONLY ` +
          `the disputed findings against the diff + the cited skill and records the deciding verdict ` +
          `with a one-line rationale. Skip the arbiter if the passes agree, or disagree only on ` +
          `\`preexisting\` findings. **Tiebreak:** when a dispute is genuinely unresolvable from the ` +
          `diff + the cited skill, severity decides — surface at the higher severity ` +
          `(\`critical\` > \`minor\` > \`preexisting\`) rather than suppress. The arbiter's verdict sets ` +
          `each disputed finding's consensus marker (\`2-of-2\` if upheld, \`arbitrated\` if not) and its ` +
          `rationale — it does not change which findings gate the merge.`
        : '';
    reviewStep =
      `Dispatch ${maxPasses} reviewer sub-agents — a ${maxPasses}-pass **${mode}** review on this ` +
      `session's subscription (bind each tier to a Claude Code model: a fast model for \`beetle\`, ` +
      `a strong model for \`wasp\`/\`mantis\`). Each pass applies the three lenses above:\n\n${passLines}\n\n` +
      `${MODE_AGGREGATION[mode]}${escalation}\n\n` +
      "**Grounding rule (every pass):** a finding only counts if it quotes the exact line from the diff " +
      "and its `line` number matches that quote — drop anything you cannot ground.";
  }

  const surface =
    trigger === 'commit'
      ? 'Surface the findings back into this session so the agent can fix them immediately. ' +
        'If the commit is clean, report a single line: `clud-bug: commit <short-sha> — clean.`'
      : 'Surface the findings into the session, and — if an open PR exists — post or edit (in ' +
        'place, by integer comment id) the clud-bug summary comment on it.';

  // 3b (rc.15) — the OPTIONAL design-critic visual pass. Rendered only when the
  // caller gated it on (design.enabled + kind:design skills + pr trigger). The
  // step itself defers to runtime: no deploy-preview URL or no browser MCP in
  // the session → skip silently. This is the local counterpart of the hosted
  // Vercel-Sandbox render path.
  const designStep = design
    ? `\n\n## 3b. Design-critic (visual review)
This repo opted into design review. If this PR has a live deploy-preview, also review the **rendered** UI — skip this whole step silently if there is no preview, or no browser MCP in this session.

1. **Find the preview URL** (GitHub deployments first, then a Vercel/Netlify status or bot comment):
\`\`\`bash
gh api "repos/{owner}/{repo}/deployments?per_page=10" --jq '.[].id' \\
  | while read -r id; do gh api "repos/{owner}/{repo}/deployments/$id/statuses" --jq '.[0].environment_url // empty'; done | head -1
\`\`\`
2. **Render** each changed rendered surface (infer the route from the changed file path) on the preview, in ${design.config.themes.join(' + ')}, at the ${design.config.viewports.join(', ')} viewport(s). Hard-refresh to bypass cached assets, then take a full-page screenshot.
3. **Critique** each screenshot against the design skills — cite the element you see + the skill, and flag what is *fine but not elite*, not only what is broken:
${design.skills.map((s) => `  - \`.claude/skills/${s}/SKILL.md\``).join('\n')}
   Record each finding with \`file\`, \`severity\` (\`critical\` | \`minor\` | \`preexisting\`), the design \`skill\`, and a one-line \`summary\`; tag design findings \`<!-- pass: design -->\`. ${
     design.config.gate === 'strict'
       ? 'Gated: a design `critical` blocks the merge (`design.gate: strict`).'
       : 'Advisory: design findings inform, they do not block the merge.'
   }`
    : '';

  return `<!-- ${CLUD_BUG_RECIPE_MARKER} v1 -->
You are **clud-bug**, running ${TRIGGER_INTRO[trigger]} inside this Claude Code session, on
this session's own model tokens — no hosted App, no extra auth (you already have \`git\`,
\`gh\`, and file access).

## The plan
clud-bug resolved this review from the repo's skills + \`.clud-bug.json\`:
**${plan.summary}**

## 1. Get the diff
${diffStep}

## 2. Load the review skills
Read each skill's discipline from the checkout:
${skillsList}

Apply them as three disciplined lenses — every finding must earn its place under one:
  - **Correctness** (critical-issues-only): real bugs only — wrong logic, broken contracts,
    unhandled cases, race conditions, performance cliffs. Skip nits and style.
  - **Security** (evidence-based-review): injection, auth/authz gaps, secret or PII exposure,
    SSRF, unsafe input — and quote the exact line that proves it.
  - **Regression** (respect-existing-conventions): does the change break an existing pattern,
    invariant, or caller? Flag where the diff fights the codebase — don't fight its conventions.

Run each lens deliberately; a generic "looks fine" is not a review. Findings that don't fit a
lens are noise — drop them.

## 3. Review
${reviewStep}${designStep}

## 4. Report
Render the body in clud-bug's standard shape (§1.8.1) — omit any empty section:

\`\`\`
## 🐛 Clud Bug review — <clean | critical findings>

**This round:** N critical · N minor · N resolved from prior · N still open

Found: N 🔴 / N 🟡 / N 🟣

<per-finding: 🔴 [skill]: <summary> (file:line) — with the quoted line + a one-line fix>

Skills referenced: [<the skills you applied>]

<!-- written-by: @<login> (clud-bug local-mode) -->
\`\`\`

${surface}

Keep it tight — this is the local safety net; the deeper review still happens at PR time.
`;
}

interface ReviewPromptArgs {
  trigger?: string;
  cwd?: string;
  diffSizeBytes?: number;
  _?: string[];
}

/**
 * `clud-bug review-prompt [--trigger commit|push|pr]` — load the repo's skills +
 * config, plan the review through `core/planReview`, and print the recipe to
 * stdout. Defaults to the `commit` trigger (the primary hook consumer).
 */
export async function runReviewPrompt(args: ReviewPromptArgs): Promise<void> {
  const cwd = args.cwd ?? process.cwd();
  const trigger = normalizeTrigger(args.trigger);

  const skillsDir = join(cwd, '.claude', 'skills');
  const manifest = await readManifest(skillsDir);

  // Load each installed skill's frontmatter (for `review_mode`), tolerating a
  // skill whose SKILL.md is missing or unparseable (skip it, don't crash).
  const skills: ReviewPlanSkill[] = [];
  // Keep the raw SKILL.md text so `planReview` can honor a skill author's
  // `review_passes:` frontmatter override (precedence layer 2) — without this
  // that layer is silently dead in local mode.
  const rawSkillMd: Record<string, string> = {};
  for (const entry of manifest.installed) {
    try {
      const raw = await readFile(join(skillsDir, entry.slug, 'SKILL.md'), 'utf8');
      skills.push({ slug: entry.slug, frontmatter: parseFrontmatter(raw) });
      rawSkillMd[entry.slug] = raw;
    } catch {
      // Skill body unreadable/unparseable — omit from the plan.
    }
  }

  // Partition by lens: `kind: design` skills drive the visual design-critic
  // pass, not the code-correctness multi-pass plan. Code skills go to
  // planReview; design skills go to the (gated) design step.
  const designSkills = skills.filter((s) => s.frontmatter.kind === 'design');
  const codeSkills = skills.filter((s) => s.frontmatter.kind !== 'design');

  const config = readReviewPassesConfig(manifest);
  const plan = planReview({
    skills: codeSkills,
    config,
    trigger,
    rawSkillMd,
    ...(args.diffSizeBytes !== undefined ? { diffSizeBytes: args.diffSizeBytes } : {}),
  });

  // The design-critic is gated: opted-in (`design.enabled`) + at least one
  // installed design skill + a `pr` trigger. The deploy-preview + browser-MCP
  // preconditions are deferred to the agent at runtime (see the rendered step).
  const designConfig = readDesignConfig(manifest);
  const design = shouldRunDesign(designConfig, designSkills.length, trigger)
    ? { skills: designSkills.map((s) => s.slug), config: designConfig }
    : undefined;

  process.stdout.write(
    renderReviewRecipe({ plan, trigger, ...(design ? { design } : {}) }) + '\n',
  );
}

function normalizeTrigger(raw: string | undefined): ReviewTrigger {
  if (raw === undefined || raw === 'commit') return 'commit';
  if (raw === 'push' || raw === 'pr') return raw;
  process.stderr.write(
    `clud-bug review-prompt: unrecognized --trigger "${raw}" (expected commit|push|pr); using commit.\n`,
  );
  return 'commit';
}
