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
//
// #239/#240 (LAUNCH-GATE) — three coverage holes fixed here:
//
//   #240 vector 1 (worktree coverage): a commit made in a LINKED git worktree
//   has its own worktree-local `git rev-parse --git-dir`
//   (`<main>/.git/worktrees/<name>`) — bookkeeping keyed off that never lands
//   where the primary checkout (or a `--pending` drain run from there) would
//   ever look. All REVIEW-STATE (the fired/done markers + the pending queue)
//   is now keyed off `git rev-parse --git-common-dir`, normalized to an
//   absolute path — the ONE location shared by every linked worktree of a
//   repo — so a commit in any worktree lands in the same bookkeeping the
//   primary checkout reads. (HEAD-moved detection below stays worktree-LOCAL
//   on purpose — see its own comment.)
//
//   #240 vector 2 (--no-verify): this is a `type: command` hook, so it SEES
//   the triggering Bash command line (piped as the PostToolUse event JSON on
//   stdin). A `git commit`/`logmind log` carrying `--no-verify` bypasses
//   whatever git hooks the repo mandates — flagged (never hard-denied: that
//   could strand a legitimate rebase/amend) via `--flag-no-verify` to
//   `review-prompt`, which renders it as an automatic finding IF the repo
//   actually declares mandated hooks (see `repoHasMandatedHooks` in
//   review-prompt.ts) — never a false alarm in a repo with no such policy.
//
//   #240 vector 3 (over-firing): the OLD belt-and-suspenders gate matched the
//   substring `'git commit'` / `'logmind log'` against the ENTIRE event JSON
//   (including free-text fields like the Bash tool's `description`), so a
//   read-only command whose description happened to mention "git commit"
//   (e.g. `git log` described as "view commit history") spuriously re-fired
//   the recipe with NO commit ever made. The fix keys firing on GIT STATE, not
//   text: `clud-bug-last-seen-head` records the HEAD this hook last observed
//   IN THIS WORKTREE; if HEAD hasn't moved, nothing was committed, full stop.
//   When HEAD HAS moved (or this is the worktree's first-ever hook fire, so
//   there's no baseline yet), `git reflog`'s own record of *why* HEAD moved
//   (`commit` / `rebase` / `merge` / … vs. a plain `checkout` or `reset`)
//   confirms a commit was actually created — which also solves a freshly
//   `git worktree add`-ed worktree's cold start for free: its reflog has
//   nothing but the worktree's own checkout until a real commit lands there.
//
//   #239 (two-phase marker + durable queue): the OLD marker was written
//   BEFORE the review ran, so a usage-limit-killed session left a marker
//   indistinguishable from a completed review. Now `clud-bug-hook-fired`
//   means only "surfaced" (pending); ONLY `clud-bug review-done <sha>` (run
//   by the agent after it actually finishes) writes `clud-bug-review-done`.
//   A fired-but-not-done sha is durably queued to `clud-bug-pending` (drained
//   via `clud-bug review --pending`) the next time the hook fires, with a
//   one-line "usage limit" deferral notice — distinct from a recipe-FETCH
//   failure, which gets its own "error" notice (same queue, different cause).

/** Stable marker embedded in our hook so re-runs — and upgrades from the old,
 * broken `type: agent` hook — replace it in place. */
export const CLUD_BUG_HOOK_MARKER = 'clud-bug-local-review';

/** `.git/clud-bug-pending` (relative to the git COMMON dir) — one sha per
 * line, durable queue of reviews that fired but never confirmed `done`
 * (a usage-limit kill) or whose recipe fetch failed (a tooling error).
 * Drained by `clud-bug review --pending`. Shared name with `src/cli/review.ts`. */
export const PENDING_QUEUE_FILE = 'clud-bug-pending';

/** Two-phase marker files (relative to the git COMMON dir, #239). `FIRED`
 * records the sha a recipe was last SURFACED for (pending, not yet
 * confirmed); `DONE` records the sha `clud-bug review-done` last confirmed
 * complete. `fired !== done` for the same sha means a review is still open. */
export const HOOK_FIRED_FILE = 'clud-bug-hook-fired';
export const REVIEW_DONE_FILE = 'clud-bug-review-done';

/**
 * Build the shell `command` of the commit-review hook. Pins to a FLOATING npm
 * dist-tag (`next` by default) rather than an exact version, so every repo's hook
 * auto-fetches the latest review recipe — no per-release re-pin rollout. (The
 * original exact-pin guarded against a `latest` that predated the `review-prompt`
 * verb; that verb now ships in every channel, so floating is safe + frictionless.)
 * Max mode is advisory, so "always newest recipe" is the right default for a
 * review tool. `pin` is overridable for a repo that wants a frozen, exact version.
 *
 * The command, in order:
 *   1. HEAD-moved gate (#240 vector 3) — a WORKTREE-LOCAL `git-dir` marker
 *      (`clud-bug-last-seen-head`) records the HEAD this hook last observed
 *      in THIS checkout. If HEAD hasn't moved, no commit happened — exit,
 *      regardless of what the triggering command's text said. This is
 *      deliberately worktree-local (not the shared common-dir): two linked
 *      worktrees have independent HEADs, and a single shared "last seen"
 *      slot would ping-pong between them and misfire on an unrelated
 *      worktree's read-only command. If HEAD DID move (or there's no
 *      baseline yet — this worktree's first-ever fire), `git reflog`'s
 *      record of *why* confirms it was a commit-creating action, not a
 *      `checkout`/`reset` — the same check closes the cold-start gap a
 *      freshly `git worktree add`-ed worktree would otherwise have.
 *   2. Two-phase marker (#239) — `clud-bug-hook-fired` / `clud-bug-review-done`,
 *      kept in the shared `--git-common-dir` (#240 vector 1) so a commit in
 *      ANY linked worktree resolves to the SAME bookkeeping the primary
 *      checkout (and a `--pending` drain run from there) will see. A sha
 *      that's `fired` but not yet `done` is still an OPEN review — never
 *      treated as complete.
 *   3. `--no-verify` flag (#240 vector 2) — the hook sees the triggering Bash
 *      command line; a `--no-verify` commit is passed through to
 *      `review-prompt` so it can render an automatic finding IF the repo
 *      declares mandated hooks.
 *   4. Fetch a fresh recipe tailored to THIS repo: `review-prompt --trigger
 *      commit` (an instruction recipe — `git show HEAD` + the skills + the
 *      report format — NOT raw data; it is meant to be FOLLOWED by an agent).
 *   5. Surface it to the session by printing it and `exit 2`, so `asyncRewake`
 *      shows it to the main agent as a system reminder. The agent then reviews
 *      the commit on the session subscription, and confirms with
 *      `clud-bug review-done <sha>` when actually done.
 *   6. Any dead end (no new commit, recipe fetch fails, a stale pending review
 *      surfaces) still `exit 2` with a one-line notice rather than going
 *      silent (#239) — the commit itself is never blocked either way (this
 *      hook runs `async` after the tool already ran).
 */
export function buildCommitReviewCommand(pin: string = 'next'): string {
  return [
    // Marker as a `#` comment (NOT a `:` no-op) so its free text can never break
    // `sh` — a paren / quote / `$` in the marker line would be a syntax error
    // under `: ...`. The dogfood caught this. `isOurHook` finds the marker here.
    `# ${CLUD_BUG_HOOK_MARKER} v3 — clud-bug commit review on the session subscription`,
    // Command hooks get the event JSON on stdin — captured for the `--no-verify`
    // text check below. It is NEVER used to decide whether to fire (that
    // caused #240 vector 3 — see the HEAD-moved gate instead).
    `ev=$(cat 2>/dev/null)`,
    `sha=$(git rev-parse HEAD 2>/dev/null) || exit 0`,
    // WORKTREE-LOCAL: each linked worktree has its own HEAD, so "did HEAD
    // move" must be checked per-worktree, not shared across the repo.
    `wtgitdir=$(git rev-parse --git-dir 2>/dev/null) || exit 0`,
    `wtgitdir=$(cd "$wtgitdir" 2>/dev/null && pwd) || exit 0`,
    // #240 vector 3 — fire only when a new commit object actually exists in
    // THIS worktree since the last time this hook ran here. The old belt-
    // and-suspenders `case "$ev" in *'git commit'*...` matched free text
    // ANYWHERE in the event JSON (e.g. a Bash `description` mentioning "git
    // commit" for an unrelated read-only command), which is how a `gh issue
    // view` / `git log` spuriously re-fired the recipe. Git state, not text.
    `seen="$wtgitdir/clud-bug-last-seen-head"`,
    `prev=$(cat "$seen" 2>/dev/null) || prev=`,
    `printf '%s' "$sha" > "$seen" 2>/dev/null || true`,
    // Cheapest check first: HEAD is byte-identical to what THIS worktree's
    // hook last observed — definitely no new commit, regardless of what the
    // triggering command's text said.
    `[ "$prev" = "$sha" ] && exit 0`,
    // HEAD differs from last time (or this is this worktree's first-ever
    // hook fire, so there's no baseline to compare against) — confirm it was
    // actually produced by a COMMIT-creating action, not a `checkout` /
    // `reset` / branch-switch (or, on a cold start, the `git worktree add`
    // that created this worktree in the first place). `git reflog` is the
    // git-native record of *why* HEAD moved — reusing it here means a brand
    // new worktree's first-ever hook fire (no prior baseline; the ONLY thing
    // in its reflog so far is the worktree's own checkout) correctly does
    // NOT fire, while its first REAL commit correctly does — solving the
    // cold-start case without any separate seeding step.
    `reason=$(git reflog -1 --format='%gs' HEAD 2>/dev/null) || reason=`,
    `case "$reason" in commit*|rebase*|pull*|cherry-pick*|revert*|merge*) ;; *) exit 0 ;; esac`,
    // #240 vector 1 — SHARED across every linked worktree of this repo:
    // `--git-common-dir` (unlike `--git-dir`) resolves to the SAME directory
    // whether invoked from the primary checkout or any linked worktree, so a
    // commit made in a worktree lands in the bookkeeping the primary
    // checkout (and `clud-bug review --pending`) actually reads.
    `gitdir=$(git rev-parse --git-common-dir 2>/dev/null) || exit 0`,
    `gitdir=$(cd "$gitdir" 2>/dev/null && pwd) || exit 0`,
    // #239 two-phase marker: `fired` means "surfaced", `done` means
    // `clud-bug review-done <sha>` actually ran. Pure loop-guard, not an
    // attestation (§10.3.3) — it never yields a green check; the only
    // authoritative "reviewed" state is the notary-issued `clud-bug-review`
    // check.
    `fired="$gitdir/${HOOK_FIRED_FILE}"`,
    `donefile="$gitdir/${REVIEW_DONE_FILE}"`,
    `pending="$gitdir/${PENDING_QUEUE_FILE}"`,
    `firedsha=$(cat "$fired" 2>/dev/null) || firedsha=`,
    `donesha=$(cat "$donefile" 2>/dev/null) || donesha=`,
    // Already fired AND confirmed done for this EXACT commit — nothing to do.
    `[ "$firedsha" = "$sha" ] && [ "$donesha" = "$sha" ] && exit 0`,
    // A DIFFERENT sha is still open (fired, never confirmed done) — the
    // session that surfaced it most likely died mid-review (a usage limit).
    // Queue it durably (never drop it) and say so plainly — #239 explicitly
    // calls out silence here as the bug.
    `note=`,
    `if [ -n "$firedsha" ] && [ "$firedsha" != "$donesha" ] && [ "$firedsha" != "$sha" ]; then`,
    `  grep -qxF "$firedsha" "$pending" 2>/dev/null || printf '%s\\n' "$firedsha" >> "$pending" 2>/dev/null || true`,
    `  note="clud-bug: review deferred (usage limit) for $firedsha — run 'clud-bug review --pending' when capacity returns."`,
    `fi`,
    // #240 vector 2 — the hook SEES the Bash command line (it's the tool
    // input this hook fired on); a `--no-verify` commit bypasses whatever
    // git hooks this repo mandates. Flag it (never hard-deny — that could
    // strand a legitimate rebase/amend) by forwarding to `review-prompt`,
    // which renders the finding only if the repo actually declares mandated
    // hooks (never a false alarm in a repo with no such policy).
    `noverifyFlag=`,
    `case "$ev" in *'--no-verify'*) noverifyFlag=' --flag-no-verify' ;; esac`,
    // H4 — one retry on a transient npx/network blip (a stale lock, a slow
    // registry) before giving up, so a hiccup doesn't silently skip the review.
    // `|| recipe=` clears it on a NON-ZERO exit so partial/error stdout from a
    // mid-run crash (or an old npm warning on stdout) is never mistaken for a
    // valid recipe — only a clean, exit-0 run surfaces.
    `recipe=$(npx clud-bug@${pin} review-prompt --trigger commit$noverifyFlag 2>/dev/null) || recipe=`,
    `if [ -z "$recipe" ]; then sleep 1; recipe=$(npx clud-bug@${pin} review-prompt --trigger commit$noverifyFlag 2>/dev/null) || recipe=; fi`,
    // H4 — when the recipe still can't be fetched, leave a diagnostic marker so a
    // FAILED review is distinguishable from a CLEAN one (a clean review surfaces
    // the recipe + the agent reports clean). #239: this is a genuine TOOLING
    // ERROR (network/npx), distinct from the usage-limit notice above — queue
    // it too (the old skip path was a dead end nothing ever drained) and say
    // so with its own message rather than going silent.
    `if [ -z "$recipe" ]; then`,
    `  printf '%s' "$sha" > "$gitdir/clud-bug-review-skipped" 2>/dev/null || true`,
    `  grep -qxF "$sha" "$pending" 2>/dev/null || printf '%s\\n' "$sha" >> "$pending" 2>/dev/null || true`,
    `  [ -n "$note" ] && printf '%s\\n\\n' "$note"`,
    `  printf "clud-bug: review deferred (error: recipe fetch failed) for %s — run 'clud-bug review --pending' once resolved.\\n" "$sha"`,
    `  exit 2`,
    `fi`,
    `printf '%s' "$sha" > "$fired" 2>/dev/null || true`,
    // #239 — queue THIS sha too, proactively, at the moment it's handed off
    // (not only reactively when a LATER commit discovers it stuck). Without
    // this, a session that dies right after this exit-2 with no commit ever
    // following it would leave a sha `fired` forever with no queue entry —
    // invisible to `clud-bug review --pending`. `review-done` removes it once
    // actually confirmed; until then it stays enumerable and drainable.
    `grep -qxF "$sha" "$pending" 2>/dev/null || printf '%s\\n' "$sha" >> "$pending" 2>/dev/null || true`,
    `[ -n "$note" ] && printf '%s\\n\\n' "$note"`,
    `printf '%s\\n\\n%s\\n' "clud-bug commit review (max mode — on this session's subscription): a commit was just made. Follow this recipe now — review that commit against the skills it names and surface any findings. When you finish, run: clud-bug review-done $sha (a killed session must never look like a completed review)." "$recipe"`,
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
