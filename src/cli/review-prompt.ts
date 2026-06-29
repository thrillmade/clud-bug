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
  parseFrontmatter,
  type ReviewPlan,
  type ReviewPlanSkill,
  type ReviewTrigger,
  type ReviewPassMode,
} from '../core/index.js';
import { readManifest } from './skills.js';

/** Marker that identifies a clud-bug local-review recipe (idempotency + hook detection). */
export const CLUD_BUG_RECIPE_MARKER = 'clud-bug-local-review';

const MODE_AGGREGATION: Record<ReviewPassMode, string> = {
  'cross-check':
    "Pass 1 reviews the diff against all the skills; each later pass re-reviews AND checks pass 1's findings (agree / disagree), adding any new ones it finds.",
  consensus:
    'Run all passes independently against all the skills, then keep only findings that two or more passes agree on.',
  independent:
    'Run all passes independently against all the skills, then take the union of their findings, each attributed to its pass.',
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
export function renderReviewRecipe(input: { plan: ReviewPlan; trigger: ReviewTrigger }): string {
  const { plan, trigger } = input;
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
      'Review the diff against every loaded skill in a single pass. For each REAL issue, ' +
      'record `file`, `line`, `severity` (`critical` | `minor` | `preexisting`), the `skill` ' +
      'that motivated it, and a one-line `summary` with the quoted offending line. Finding ' +
      'nothing is the normal outcome — be precise, not exhaustive.';
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
          `\`preexisting\` findings. The arbiter's verdict sets each disputed finding's consensus ` +
          `marker (\`2-of-2\` if upheld, \`arbitrated\` if not) and its rationale — it does not change ` +
          `which findings gate the merge.`
        : '';
    reviewStep =
      `Dispatch ${maxPasses} reviewer sub-agents — a ${maxPasses}-pass **${mode}** review on this ` +
      `session's subscription (bind each tier to a Claude Code model: a fast model for \`beetle\`, ` +
      `a strong model for \`wasp\`/\`mantis\`):\n\n${passLines}\n\n${MODE_AGGREGATION[mode]}${escalation}`;
  }

  const surface =
    trigger === 'commit'
      ? 'Surface the findings back into this session so the agent can fix them immediately. ' +
        'If the commit is clean, report a single line: `clud-bug: commit <short-sha> — clean.`'
      : 'Surface the findings into the session, and — if an open PR exists — post or edit (in ' +
        'place, by integer comment id) the clud-bug summary comment on it.';

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

Apply them strictly — at minimum **critical-issues-only** (flag only correctness, security,
or performance bugs — skip nits), **evidence-based-review** (quote the exact line you flag),
and **respect-existing-conventions** (don't fight the codebase's patterns).

## 3. Review
${reviewStep}

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

  const config = readReviewPassesConfig(manifest);
  const plan = planReview({
    skills,
    config,
    trigger,
    rawSkillMd,
    ...(args.diffSizeBytes !== undefined ? { diffSizeBytes: args.diffSizeBytes } : {}),
  });

  process.stdout.write(renderReviewRecipe({ plan, trigger }) + '\n');
}

function normalizeTrigger(raw: string | undefined): ReviewTrigger {
  if (raw === undefined || raw === 'commit') return 'commit';
  if (raw === 'push' || raw === 'pr') return raw;
  process.stderr.write(
    `clud-bug review-prompt: unrecognized --trigger "${raw}" (expected commit|push|pr); using commit.\n`,
  );
  return 'commit';
}
