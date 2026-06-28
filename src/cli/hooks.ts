// Wave 6b — Claude Code `type: agent` commit-review hook scaffolding.
//
// `clud-bug init --with-hooks` writes a native Claude Code hook that, on every
// `git commit` the agent makes, spawns a clud-bug review SUBAGENT in the same
// session — so it runs on the session's subscription (no API key), in the
// background (the commit never blocks), and surfaces findings back to the agent.
//
// The model (see the Wave 6b plan): clud-bug supplies the *recipe* (the
// agent-hook `prompt`); Claude Code runs it as a subagent. This is the dynamic,
// always-on counterpart to the `/clud-bug-review` slash command.
//
// `type: agent` hooks are documented as experimental; the same outcome is
// reachable via a `type: command` hook + `additionalContext` if the API shifts.

/** Stable marker embedded in our hook's prompt so re-runs replace it in place. */
export const CLUD_BUG_HOOK_MARKER = 'clud-bug-local-review';

/**
 * Build the `prompt` of the Claude Code `type: agent` commit-review hook,
 * pinned to the clud-bug VERSION that scaffolded it. Pinning matters: a bare
 * `npx clud-bug` resolves to the `latest` dist-tag, which can predate the
 * `review-prompt` verb (e.g. while v0.7 is prerelease on `next`); `@${version}`
 * guarantees the verb exists. `clud-bug update` refreshes the pin in place.
 *
 * Rather than baking a static recipe (which would drift from the repo's
 * skills/config), it tells the subagent to run `clud-bug review-prompt` — the
 * engine-driven verb that emits a recipe tailored to THIS repo's resolved plan
 * — and follow it. The recipe is generated fresh at commit time, always current.
 */
export function buildCommitReviewPrompt(version: string): string {
  return `<!-- ${CLUD_BUG_HOOK_MARKER} v1 -->
You are clud-bug's local commit review, running as a background subagent on this
session's own subscription (no extra auth — you have git, gh, and file access).

Step 1 — get your review recipe from clud-bug's engine:

    npx clud-bug@${version} review-prompt --trigger commit

That prints a structured review recipe tailored to THIS repo's skills + config (a
fast single pass for a commit). If that command isn't available, run the repo's
installed clud-bug CLI's \`review-prompt --trigger commit\` instead.

Step 2 — follow that recipe exactly: review the commit that was just made against
the skills it names, and surface any findings back into the session so they can be
fixed. A clean commit needs only a one-line note.

Keep it tight — this is the commit-time safety net; the deeper review runs at PR time.`;
}

/** One Claude Code hook entry: a tool matcher plus its hook list. */
export interface HookMatcherEntry {
  matcher?: string;
  hooks: Array<Record<string, unknown>>;
}

/** Minimal shape of the `.claude/settings.json` we read + merge into. */
export interface ClaudeSettings {
  hooks?: Record<string, HookMatcherEntry[]>;
  [key: string]: unknown;
}

/**
 * Builds the PostToolUse entry that spawns the commit-review subagent: a native
 * `type: agent` hook that is backgrounded (`async`), surfaces findings
 * (`asyncRewake`), and fires only on `git commit` (`if`).
 */
export function buildLocalReviewHook(recipe: string): HookMatcherEntry {
  return {
    matcher: 'Bash',
    hooks: [
      {
        type: 'agent',
        if: 'Bash(git commit *)',
        async: true,
        asyncRewake: true,
        timeout: 180,
        prompt: recipe,
      },
    ],
  };
}

function isOurHook(h: Record<string, unknown> | undefined): boolean {
  return typeof h?.['prompt'] === 'string' && (h['prompt'] as string).includes(CLUD_BUG_HOOK_MARKER);
}

function isCludBugReviewEntry(entry: HookMatcherEntry | undefined): boolean {
  return !!entry && Array.isArray(entry.hooks) && entry.hooks.some(isOurHook);
}

/**
 * Merges the clud-bug commit-review hook into an existing `.claude/settings.json`
 * object. **Idempotent** (replaces any prior clud-bug entry rather than
 * duplicating) and **non-clobbering** (preserves every other top-level key,
 * every other event, and every other hook). Tolerates a missing/malformed
 * `existing` value.
 */
export function mergeLocalReviewHook(existing: unknown, recipe: string): ClaudeSettings {
  const base: ClaudeSettings =
    existing && typeof existing === 'object' ? { ...(existing as ClaudeSettings) } : {};
  const hooks: Record<string, HookMatcherEntry[]> = { ...(base.hooks ?? {}) };
  const priorPost = Array.isArray(hooks.PostToolUse) ? hooks.PostToolUse : [];

  // Preserve every non-clud-bug hook — including any the user co-located INSIDE
  // our own matcher entry: drop only the hook(s) carrying our marker, never the
  // whole entry.
  const ours = buildLocalReviewHook(recipe);
  const otherEntries: HookMatcherEntry[] = [];
  const coLocatedUserHooks: Array<Record<string, unknown>> = [];
  for (const entry of priorPost) {
    if (isCludBugReviewEntry(entry)) {
      for (const h of entry.hooks) if (!isOurHook(h)) coLocatedUserHooks.push(h);
    } else {
      otherEntries.push(entry);
    }
  }
  const ourEntry: HookMatcherEntry =
    coLocatedUserHooks.length > 0 ? { ...ours, hooks: [...coLocatedUserHooks, ...ours.hooks] } : ours;
  hooks.PostToolUse = [...otherEntries, ourEntry];
  base.hooks = hooks;
  return base;
}
