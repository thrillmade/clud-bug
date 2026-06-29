// Wave 6b (rc.17 fix) — Claude Code `type: command` commit-review hook scaffolding.
//
// `clud-bug init --with-hooks` writes a native Claude Code hook that, on every
// `git commit`, runs clud-bug's review recipe ON THIS SESSION'S SUBSCRIPTION
// (no API key), in the background (the commit never blocks).
//
// WHY `type: command`, NOT `type: agent`: a Claude Code `type: agent` hook
// spawns a subagent restricted to Read/Grep/Glob — it has NO Bash and the tool
// set is not configurable (see code.claude.com/docs/en/hooks: "spawn a subagent
// that can use tools like Read, Grep, and Glob"). The original Wave 6b hook used
// `type: agent` and told the subagent to run `npx clud-bug review-prompt` — a
// Bash CLI call an agent hook can never make — so the review NEVER ran for
// anyone. A `type: command` hook CAN run the CLI: it fetches the engine's recipe
// and surfaces it to the session via exit-2 (`asyncRewake`), so the MAIN agent —
// which has Bash, git, gh, and the subscription — performs the review. The hook
// exits 0 on any failure, so a review that can't run is a quiet no-op and the
// commit is NEVER blocked.

/** Stable marker embedded in our hook so re-runs — and upgrades from the old,
 * broken `type: agent` hook — replace it in place. */
export const CLUD_BUG_HOOK_MARKER = 'clud-bug-local-review';

/**
 * Build the shell `command` of the commit-review hook, pinned to the clud-bug
 * VERSION that scaffolded it (a bare `npx clud-bug` resolves to the `latest`
 * dist-tag, which can predate the `review-prompt` verb; `@${version}` guarantees
 * it). `clud-bug update` refreshes the pin in place.
 *
 * The command, in order:
 *   1. Idempotency — skip if this exact HEAD was already surfaced (avoids a
 *      re-review on an amend-with-no-change or a double-fire). The reviewed SHA
 *      is recorded under `.git/` (untracked), reusing the "last-reviewed-sha"
 *      idea the hosted bot uses on PR comments.
 *   2. Fetch a fresh recipe tailored to THIS repo: `review-prompt --trigger
 *      commit` (an instruction recipe — `git show HEAD` + the skills + the
 *      report format — NOT raw data; it is meant to be FOLLOWED by an agent).
 *   3. Surface it to the session by printing it and `exit 2`, so `asyncRewake`
 *      shows it to the main agent as a system reminder. The agent then reviews
 *      the commit on the session subscription.
 *   4. Any failure or empty output → `exit 0` (quiet; the commit is never blocked).
 */
export function buildCommitReviewCommand(version: string): string {
  return [
    // Marker as a `#` comment (NOT a `:` no-op) so its free text can never break
    // `sh` — a paren / quote / `$` in the marker line would be a syntax error
    // under `: ...`. The dogfood caught this. `isOurHook` finds the marker here.
    `# ${CLUD_BUG_HOOK_MARKER} v2 — clud-bug commit review on the session subscription`,
    // Belt-and-suspenders gate. The `if: Bash(git commit *)` / `Bash(logmind log *)`
    // field filters at the platform on Claude Code >= 2.1.85; OLDER CC ignores
    // `if` and would fire this on EVERY Bash call (a review recipe after every
    // command). Command hooks get the event JSON on stdin — re-check it here. If
    // stdin is empty (a CC that doesn't pipe it), fall through and trust `if`.
    `ev=$(cat 2>/dev/null)`,
    `if [ -n "$ev" ]; then case "$ev" in *'git commit'*|*'logmind log'*) ;; *) exit 0 ;; esac; fi`,
    `sha=$(git rev-parse HEAD 2>/dev/null) || exit 0`,
    `gitdir=$(git rev-parse --git-dir 2>/dev/null) || exit 0`,
    `marker="$gitdir/clud-bug-last-commit-review"`,
    `[ "$(cat "$marker" 2>/dev/null)" = "$sha" ] && exit 0`,
    `recipe=$(npx clud-bug@${version} review-prompt --trigger commit 2>/dev/null) || exit 0`,
    `[ -n "$recipe" ] || exit 0`,
    `printf '%s' "$sha" > "$marker" 2>/dev/null || true`,
    `printf '%s\\n\\n%s\\n' "clud-bug commit review (max mode — on this session's subscription): a commit was just made. Follow this recipe now — review that commit against the skills it names and surface any findings." "$recipe"`,
    `exit 2`,
  ].join('\n');
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
 * Builds the PostToolUse entry that runs the commit-review command: a native
 * `type: command` hook, backgrounded (`async`), surfacing the recipe back to the
 * session (`asyncRewake` + exit 2), firing only on `git commit` (`if`).
 */
export function buildLocalReviewHook(command: string): HookMatcherEntry {
  const base = { type: 'command', async: true, asyncRewake: true, timeout: 180, command } as const;
  return {
    matcher: 'Bash',
    hooks: [
      { ...base, if: 'Bash(git commit *)' },
      // thrillmade repos (and any logmind user) commit via `logmind log`, which
      // wraps `git commit` inside its own binary — so the Bash tool call is
      // `logmind log ...`, which `Bash(git commit *)` never matches. Fire on it
      // too, or max mode never triggers in a logmind repo. The idempotency
      // SHA-marker means whichever path runs, a commit is reviewed exactly once.
      { ...base, if: 'Bash(logmind log *)' },
    ],
  };
}

function isOurHook(h: Record<string, unknown> | undefined): boolean {
  // Match our marker in `command` (current `type: command` hook) OR `prompt`
  // (the old, broken `type: agent` hook) so a re-install / `clud-bug update`
  // replaces either in place.
  const field = h?.['command'] ?? h?.['prompt'];
  return typeof field === 'string' && field.includes(CLUD_BUG_HOOK_MARKER);
}

function isCludBugReviewEntry(entry: HookMatcherEntry | undefined): boolean {
  return !!entry && Array.isArray(entry.hooks) && entry.hooks.some(isOurHook);
}

/**
 * Merges the clud-bug commit-review hook into an existing `.claude/settings.json`
 * object. **Idempotent** (replaces any prior clud-bug entry — including the old
 * `type: agent` one — rather than duplicating) and **non-clobbering** (preserves
 * every other top-level key, event, and hook). Tolerates a missing/malformed
 * `existing` value.
 */
export function mergeLocalReviewHook(existing: unknown, command: string): ClaudeSettings {
  const base: ClaudeSettings =
    existing && typeof existing === 'object' ? { ...(existing as ClaudeSettings) } : {};
  const hooks: Record<string, HookMatcherEntry[]> = { ...(base.hooks ?? {}) };
  const priorPost = Array.isArray(hooks.PostToolUse) ? hooks.PostToolUse : [];

  // Preserve every non-clud-bug hook — including any the user co-located INSIDE
  // our own matcher entry: drop only the hook(s) carrying our marker, never the
  // whole entry.
  const ours = buildLocalReviewHook(command);
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
