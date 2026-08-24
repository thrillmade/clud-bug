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
//
// #249 (authorship filter — follow-up to #240 vector 3): the reflog-reason
//   gate above confirms HEAD moved via a commit-creating action, but
//   `pull*`/`merge*` (and, in principle, `cherry-pick*`) can land a commit
//   somebody ELSE authored that already passed review at PR time — a `git
//   pull --ff-only` fast-forwards HEAD straight onto the PR's own commit; no
//   new commit object is created, so its author is whoever opened the PR,
//   not necessarily whoever ran `pull`. Re-reviewing that is pure noise
//   (dogfooded 2026-07-25: firing on every routine pull of a teammate's
//   merged PR). A genuine LOCAL merge — conflict hand-resolved, or a real
//   non-ff `git merge` — creates a NEW commit object whose author is
//   whoever ran the merge, i.e. the local user, so it still fires; only an
//   already-existing foreign commit reached via fast-forward is skipped.
//   The filter keys on git CONFIG identity (`user.email`/`user.name`) vs.
//   the new HEAD commit's author, not on the reflog verb, so `commit*` /
//   `rebase*` / `cherry-pick*` / `revert*` get the same treatment for free.
//   It FAILS OPEN (fires) whenever authorship can't be established — local
//   identity unset, or the commit's author can't be read — because a false
//   FIRE is noise but a false SKIP is an unreviewed commit, exactly the bug
//   class #239/#240 exist to prevent.

/** Stable marker embedded in our hook so re-runs — and upgrades from the old,
 * broken `type: agent` hook — replace it in place. */
export const CLUD_BUG_HOOK_MARKER = 'clud-bug-local-review';

/** #276 — stable marker embedded in the git `pre-push` hook, so a re-install
 * (or `clud-bug update`) replaces OUR script in place and never clobbers a
 * hook somebody else wrote. Deliberately distinct from `CLUD_BUG_HOOK_MARKER`:
 * the two surfaces install into different files and are chosen independently
 * (SPEC 2.0 §4.1 — "the repository chooses when: after a commit, or before a
 * push"). */
export const CLUD_BUG_PREPUSH_MARKER = 'clud-bug-pre-push-review';

/** Basename of the git hook we own, inside `git rev-parse --git-path hooks`. */
export const PREPUSH_HOOK_FILE = 'pre-push';

/** Where a PRE-EXISTING foreign `pre-push` is preserved when clud-bug takes
 * ownership. SPEC 2.0 §6.7: "Git allows one `pre-push` hook, so ownership
 * follows what is installed: … both tools → either, and it MUST invoke the
 * other." We move theirs aside (never delete it) and invoke it first. */
export const PREPUSH_CHAINED_FILE = 'pre-push.clud-bug-chained';

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
 *   2. Authorship filter (#249) — even though HEAD moved via an allowed
 *      commit-creating action, the new HEAD commit may have been authored by
 *      someone else (a `pull --ff-only` landing a teammate's already-reviewed
 *      PR commit, most commonly). Compares the commit's author against the
 *      local `git config user.email`/`user.name` (case-insensitively, either
 *      field matching is enough) and exits quietly if it's provably someone
 *      else's work. A genuine local merge (hand-resolved or a real non-ff
 *      `git merge`) creates a new commit authored by the local user, so it
 *      still passes. FAILS OPEN (does not exit) when identity or authorship
 *      can't be determined — see the file-header #249 note for the full
 *      rationale.
 *   3. Two-phase marker (#239) — `clud-bug-hook-fired` / `clud-bug-review-done`,
 *      kept in the shared `--git-common-dir` (#240 vector 1) so a commit in
 *      ANY linked worktree resolves to the SAME bookkeeping the primary
 *      checkout (and a `--pending` drain run from there) will see. A sha
 *      that's `fired` but not yet `done` is still an OPEN review — never
 *      treated as complete.
 *   4. `--no-verify` flag (#240 vector 2) — the hook sees the triggering Bash
 *      command line; a `--no-verify` commit is passed through to
 *      `review-prompt` so it can render an automatic finding IF the repo
 *      declares mandated hooks.
 *   5. Fetch a fresh recipe tailored to THIS repo: `review-prompt --trigger
 *      commit` (an instruction recipe — `git show HEAD` + the skills + the
 *      report format — NOT raw data; it is meant to be FOLLOWED by an agent).
 *   6. Surface it to the session by printing it and `exit 2`, so `asyncRewake`
 *      shows it to the main agent as a system reminder. The agent then reviews
 *      the commit on the session subscription, and confirms with
 *      `clud-bug review-done <sha>` when actually done.
 *   7. Any dead end (no new commit, recipe fetch fails, a stale pending review
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
    // #249 — authorship filter. The reflog check above only confirms a
    // commit-creating action happened; `pull*`/`merge*` (via fast-forward)
    // can land a commit someone ELSE authored that already passed review at
    // PR time. Compare the new HEAD commit's author against the LOCAL git
    // identity — never the reflog verb — so a hand-resolved local merge or a
    // real non-ff `git merge` (whose author is whoever ran the merge, i.e.
    // the local user) still fires, while a foreign commit reached via
    // fast-forward does not.
    `cfgemail=$(git config user.email 2>/dev/null) || cfgemail=`,
    `cfgname=$(git config user.name 2>/dev/null) || cfgname=`,
    // Only attempt the comparison when SOME local identity is configured.
    // Both empty (no repo/global user.email or user.name at all) means
    // authorship can never be established here — fail OPEN and fire, per the
    // #249 ruling that uncertainty must resolve toward reviewing, not skipping.
    `if [ -n "$cfgemail" ] || [ -n "$cfgname" ]; then`,
    `  if aemail=$(git log -1 --format='%ae' "$sha" 2>/dev/null) && aname=$(git log -1 --format='%an' "$sha" 2>/dev/null); then`,
    // Case-insensitive (`tr`, not bash's `${var,,}` — this runs under `sh`):
    // the same human's own commits in this repo carry multiple differing
    // emails across machines with a stable name, so match on EITHER field —
    // requiring BOTH would false-negative the user's own work.
    `    lc_cfgemail=$(printf '%s' "$cfgemail" | tr '[:upper:]' '[:lower:]')`,
    `    lc_cfgname=$(printf '%s' "$cfgname" | tr '[:upper:]' '[:lower:]')`,
    `    lc_aemail=$(printf '%s' "$aemail" | tr '[:upper:]' '[:lower:]')`,
    `    lc_aname=$(printf '%s' "$aname" | tr '[:upper:]' '[:lower:]')`,
    `    emailMatch=0; [ -n "$lc_cfgemail" ] && [ "$lc_cfgemail" = "$lc_aemail" ] && emailMatch=1`,
    `    nameMatch=0; [ -n "$lc_cfgname" ] && [ "$lc_cfgname" = "$lc_aname" ] && nameMatch=1`,
    // Both fields provably mismatch (identity IS known, and it's NOT this
    // commit's author) — someone else's already-reviewed work. Skip quietly.
    `    if [ "$emailMatch" = 0 ] && [ "$nameMatch" = 0 ]; then exit 0; fi`,
    `  fi`,
    // else: local identity is configured but the commit's author couldn't be
    // read — undeterminable; fall through and fire rather than guess.
    `fi`,
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

// ---------------------------------------------------------------------------
// #276 — the PRE-PUSH surface (SPEC 2.0 §6.7 / §4.1).
//
// Until this landed, `git grep -inE 'pre-push|prePush|pre_push' origin/main --
// src/ templates/` returned ZERO hits (control probe: `PostToolUse` → 2 files),
// while SPEC 2.0 §4.1 says of the local review: "Where it is enabled, the
// repository chooses when: after a commit, or before a push. A reviewer MUST
// support both, and push is the default". §6.7 names the mechanism outright:
// "Git allows one `pre-push` hook, so ownership follows what is installed".
//
// WHY A GIT HOOK AND NOT A SECOND CLAUDE CODE HOOK. The commit surface is a
// Claude Code `PostToolUse` entry because there is no git hook that fires
// after a Bash `git commit` inside a session without blocking it. Push is the
// opposite: git HAS a `pre-push` hook, §6.7 names it by that name, and a git
// hook covers the terminal user too. It also still reaches the agent — inside
// a session `git push` is a Bash tool call, so this script's stderr lands in
// the tool result the agent reads. One mechanism, both audiences.
//
// WHY NO NETWORK IN THIS SCRIPT. `buildCommitReviewCommand` can afford an
// `npx` round-trip because Claude Code runs it detached (`async: true,
// asyncRewake: true, timeout: 180` — see `buildLocalReviewHook`). Git offers
// no such affordance: a `pre-push` hook is SYNCHRONOUS and sits on the
// critical path of every push, so a hung registry call would stall the very
// command §4.1 says must not be blocked. This script therefore does no I/O
// that can hang — it prints the exact `review-prompt --trigger push` command,
// with the computed range already filled in, and the agent (which has Bash)
// runs it.
//
// THE ORDER IS FIXED (§6.7): "the mechanical check runs first, and the model
// only runs if it passes." So: chained hook → declared test command → review
// directive. A failing DECLARED test command blocks the push. Nothing else
// does — §4.1 "The local review is advisory and MUST NOT block the command
// that triggered it", and §6.7 "An engine that is missing, stale, or cannot
// resolve its configuration ALLOWS … A broken binary MUST NOT be able to
// wedge a push." Every allow-path still SAYS why it allowed, because §6.5
// forbids the silent version: "A gate that cannot run MUST report that it
// could not, and MUST NOT exit successfully in silence."
//
// #319 shipped the rest of the declaration matrix this comment used to flag
// as deliberately missing: suite DETECTION (TEST_FILE_PATTERN /
// PKG_TEST_SCRIPT_PARSER below), the three rows that BLOCK a push when the
// declaration is missing or contradicted, and the bootstrap exemption that
// keeps a repo from being wedged by its own fix (§6.7: "A push whose only
// change is adding that declaration MUST be allowed"). `resolveTestsDeclaration`
// below is `init`'s side of the same gap: §6.7 also requires setup itself to
// ask and not complete without an answer, so a fresh install never reaches
// its first push with nothing declared in the first place.

/** Parses `tests` out of a `.clud-bug.json` on stdin and prints it. A real
 * parser (§ evidence discipline: never ad-hoc-parse a structured file from
 * shell). Single-quote-free so it can be embedded in `node -e '…'`. */
const TESTS_DECL_PARSER =
  'let s="";process.stdin.on("data",function(d){s+=d}).on("end",function(){' +
  'try{var j=JSON.parse(s);var t=j&&j.tests;' +
  'if(typeof t==="string")process.stdout.write(t.trim());' +
  'else if(t&&typeof t==="object"&&typeof t.command==="string")process.stdout.write(t.command.trim())}' +
  'catch(e){}})';

// #319 — the other half of §6.7's declaration matrix (#276 deliberately left
// this out; see the block comment above buildPrePushHookScript). Quoting the
// table in full:
//
//   | Suite detected | Declared | Result |
//   | yes | a command | run it; a failure blocks |
//   | yes | `none` | block — the declaration contradicts the repository |
//   | yes | nothing | block — it has tests and is not running them |
//   | no | a command | run it; a failure blocks |
//   | no | `none` | pass |
//   | no | nothing | block, with the exemption below |
//
// Read closely, DETECTION only ever changes a VERDICT (not just a message)
// on the `none` row: "Detection is what makes `none` honest: it cannot be
// pasted into a repository the detector can see has tests." Every "nothing"
// row already blocks regardless of what's detected (the yes/no split there
// exists to explain the reason, not to gate the result) — and a declared
// command always runs regardless of detection. TEST_FILE_PATTERN and
// PKG_TEST_SCRIPT_PARSER below are the two signals that answer "detected":
// purely local, no-network, read from the SAME base ref as the declaration
// (§6.3 applied on the machine).

/** §6.7 suite detection, signal 1: filenames on the base ref matching common
 * test-file conventions across languages — `foo.test.ts`, `foo_test.go`,
 * `test_foo.py`, a `tests/`/`__tests__/`/`spec/` directory, `foo_spec.rb`.
 * Matched with `grep -Eiq` against `git ls-tree -r --name-only <baseref>`.
 * A heuristic, not a proof: false positives cost a one-line `.clud-bug.json`
 * declaration (itself exempted below); false negatives fall back to signal 2
 * or to detection reading `no`, which only ever weakens a verdict toward
 * `pass`/`block-with-generic-message`, never toward a false pass on a real
 * suite (that direction is signal 2's job for the common JS case, and the
 * conservative default otherwise). Single-quote-free — embedded in
 * `grep -Eiq '…'`. */
const TEST_FILE_PATTERN =
  '(^|/)(tests?|__tests__|spec)/|\\.(test|spec)\\.[cm]?[jt]sx?$|' +
  '(^|/)test_[^/]+\\.py$|_test\\.py$|_test\\.go$|_spec\\.rb$';

/** §6.7 suite detection, signal 2: `package.json`'s own `scripts.test`, when
 * it is a REAL command — not the placeholder every `npm init` writes
 * (`"echo \"Error: no test specified\" && exit 1"`), which declares nothing
 * about the repository. Single-quote-free, same reason as TESTS_DECL_PARSER. */
const PKG_TEST_SCRIPT_PARSER =
  'let s="";process.stdin.on("data",function(d){s+=d}).on("end",function(){' +
  'try{var j=JSON.parse(s);var t=j&&j.scripts&&j.scripts.test;' +
  'if(typeof t==="string"){var v=t.trim();' +
  'var isPlaceholder=/^echo\\s+"Error:\\s*no\\s*test\\s*specified"\\s*&&\\s*exit\\s*1$/i.test(v);' +
  'if(v&&!isPlaceholder)process.stdout.write("1")}}' +
  'catch(e){}})';

/**
 * Build the POSIX-sh body of the git `pre-push` hook.
 *
 * Pure, like `buildCommitReviewCommand` — the caller writes it to
 * `git rev-parse --git-path hooks`/pre-push and chmods it. `pin` selects the
 * npm dist-tag named in the printed command (floating `next` by default, same
 * rationale as the commit hook: always the newest recipe).
 *
 * The script, in order:
 *   1. Slurp git's ref lines from stdin (`<local ref> <local oid> <remote ref>
 *      <remote oid>`, one per pushed ref) so they can be REPLAYED to a chained
 *      hook — consuming stdin without replaying it is how chaining silently
 *      breaks the other tool.
 *   2. §6.7 ownership — invoke a pre-existing foreign hook we moved aside, with
 *      stdin replayed and our own argv forwarded, and honour its exit status.
 *   3. Compute ONE range per pushed ref (see `--range` in review-prompt.ts for
 *      why one review of the range, not one per commit). A branch DELETION has
 *      nothing to review; a NEW branch has no remote oid, so the base comes
 *      from the merge-base with the remote's default head, falling back to the
 *      parent of the oldest not-yet-remote commit.
 *   4. §6.7 mechanical check — resolve the `tests` declaration from the
 *      DEFAULT BRANCH ("read from the default branch, never the working tree"),
 *      through a real JSON parser, and run it. Non-zero blocks; the model does
 *      not run. #319 CRITICAL: if the parser itself cannot run (`node`
 *      missing/broken), that is the TOOL failing, not a declaration — allow
 *      and say so, distinct from every other row in this step (6.7: "a broken
 *      binary MUST NOT be able to wedge a push").
 *   5. Print the review directive naming the exact command + range, and exit 0.
 *
 * Every `git` invocation inside the ref loop redirects stdin from /dev/null:
 * the loop reads from a here-doc, and a child that inherits it would eat the
 * remaining ref lines.
 */
export function buildPrePushHookScript(pin: string = 'next'): string {
  return [
    `#!/bin/sh`,
    `# ${CLUD_BUG_PREPUSH_MARKER} v1 — the local gate before work is published (SPEC 2.0 6.7).`,
    `#`,
    `# Order is fixed (6.7): the mechanical check runs first, and the model only`,
    `# runs if it passes. The review half is ADVISORY and never blocks the push`,
    `# (4.1); only a DECLARED test command that fails blocks it. Everything else`,
    `# fails OPEN, and says why (6.5 forbids the silent version).`,
    `#`,
    `# Managed by clud-bug. Edits are replaced on the next 'clud-bug init'/'update'.`,
    ``,
    `remote=$1`,
    `[ -n "$remote" ] || remote=origin`,
    `refs=$(cat 2>/dev/null) || refs=`,
    `hooksdir=$(git rev-parse --git-path hooks 2>/dev/null </dev/null) || hooksdir=`,
    ``,
    `# --- 1. chained hook (6.7: "both tools -> either, and it MUST invoke the other")`,
    `chained="$hooksdir/${PREPUSH_CHAINED_FILE}"`,
    `if [ -n "$hooksdir" ] && [ -x "$chained" ]; then`,
    `  if [ -n "$refs" ]; then`,
    `    printf '%s\\n' "$refs" | "$chained" "$@"`,
    `  else`,
    `    "$chained" "$@" </dev/null`,
    `  fi`,
    `  chainstatus=$?`,
    `  if [ "$chainstatus" -ne 0 ]; then`,
    `    printf 'clud-bug: push blocked by the pre-push hook clud-bug chained to (exit %s).\\n' "$chainstatus" >&2`,
    `    exit "$chainstatus"`,
    `  fi`,
    `fi`,
    ``,
    `# --- 2. what is actually being published`,
    `range=`,
    `nrefs=0`,
    `nreal=0`,
    `while read -r lref loid rref roid; do`,
    `  [ -n "$lref" ] || continue`,
    // An all-zero LOCAL oid is a branch deletion — no diff exists to review.
    `  isreal=0`,
    `  case "$loid" in *[!0]*) isreal=1 ;; esac`,
    `  [ "$isreal" = 1 ] || continue`,
    `  nreal=$((nreal + 1))`,
    // An all-zero REMOTE oid is a branch the remote has never seen.
    `  base=`,
    `  case "$roid" in *[!0]*) base=$roid ;; esac`,
    `  if [ -z "$base" ]; then`,
    `    base=$(git merge-base "$loid" "refs/remotes/$remote/HEAD" 2>/dev/null </dev/null) || base=`,
    `  fi`,
    `  if [ -z "$base" ]; then`,
    `    oldest=$(git rev-list "$loid" --not --remotes 2>/dev/null </dev/null | tail -n 1) || oldest=`,
    `    if [ -n "$oldest" ]; then`,
    `      base=$(git rev-parse --verify --quiet "$oldest^" 2>/dev/null </dev/null) || base=`,
    `    fi`,
    `  fi`,
    `  [ -n "$base" ] || continue`,
    `  nrefs=$((nrefs + 1))`,
    `  if [ -z "$range" ]; then range="$base..$loid"; fi`,
    `done <<CLUD_BUG_REFS`,
    `$refs`,
    `CLUD_BUG_REFS`,
    ``,
    `if [ "$nreal" -eq 0 ]; then`,
    // Every pushed ref was a deletion (or the stdin protocol gave us nothing):
    // there is no diff in existence to review, and no gate to report on.
    `  printf 'clud-bug: nothing to review on this push (no ref carries a diff). Push allowed.\\n' >&2`,
    `  exit 0`,
    `fi`,
    ``,
    `# --- 3. mechanical check FIRST (6.7). The declaration is read from the`,
    `#        DEFAULT BRANCH, never the working tree — 6.3 applied on the machine,`,
    `#        so editing the local config changes nothing until it is merged.`,
    `baseref=$(git symbolic-ref --quiet --short "refs/remotes/$remote/HEAD" 2>/dev/null </dev/null) || baseref=`,
    `if [ -z "$baseref" ]; then`,
    `  for cand in main master; do`,
    `    if git rev-parse --verify --quiet "refs/remotes/$remote/$cand" >/dev/null 2>&1 </dev/null; then`,
    `      baseref="$remote/$cand"`,
    `      break`,
    `    fi`,
    `  done`,
    `fi`,
    `testdecl=`,
    // #319 CRITICAL — `nodeerror` separates "node ran and the declaration is
    // legitimately absent" (testdecl stays empty; node itself exits 0 —
    // TESTS_DECL_PARSER swallows its own JSON.parse errors) from "node itself
    // could not run" (missing binary, corrupted install — a non-zero exit
    // from the invocation). Conflating the two treats a broken TOOLCHAIN as a
    // repo-config state and blocks the push on it — exactly what 6.7
    // forbids: "An engine that is missing, stale, or cannot resolve its
    // configuration ALLOWS ... A broken binary MUST NOT be able to wedge a
    // push." Shared with the suite-detection node call below — either read
    // failing takes the whole verdict fail-open (3c), not just its own row.
    `nodeerror=0`,
    `if [ -n "$baseref" ]; then`,
    `  cfg=$(git show "$baseref:.claude/skills/.clud-bug.json" 2>/dev/null </dev/null) || cfg=`,
    `  if [ -n "$cfg" ]; then`,
    `    if ! testdecl=$(printf '%s' "$cfg" | node -e '${TESTS_DECL_PARSER}' 2>/dev/null); then`,
    `      testdecl=`,
    `      nodeerror=1`,
    `    fi`,
    `  fi`,
    `fi`,
    ``,
    `# --- 3a. #319 — suite detection (§6.7's declaration matrix). Read from the`,
    `#         SAME base ref as the declaration above, never the working tree.`,
    `#         Two local, no-network signals; either is enough (see the table`,
    `#         quoted above buildPrePushHookScript's TEST_FILE_PATTERN).`,
    `suitedetected=0`,
    `if [ -n "$baseref" ]; then`,
    `  if git ls-tree -r --name-only "$baseref" 2>/dev/null </dev/null | grep -Eiq '${TEST_FILE_PATTERN}'; then`,
    `    suitedetected=1`,
    `  fi`,
    `  if [ "$suitedetected" = 0 ]; then`,
    `    pkgjson=$(git show "$baseref:package.json" 2>/dev/null </dev/null) || pkgjson=`,
    `    if [ -n "$pkgjson" ]; then`,
    // Same node-failure/legitimately-empty split as the declaration read
    // above — a broken node here must not silently under-detect a real
    // suite and fall through to a block; it sets the SAME `nodeerror` flag.
    `      if pkgtest=$(printf '%s' "$pkgjson" | node -e '${PKG_TEST_SCRIPT_PARSER}' 2>/dev/null); then`,
    `        [ "$pkgtest" = "1" ] && suitedetected=1`,
    `      else`,
    `        nodeerror=1`,
    `      fi`,
    `    fi`,
    `  fi`,
    `fi`,
    ``,
    `# --- 3b. #319 — the bootstrap exemption. §6.7: "A push whose only change`,
    `#         is adding that declaration MUST be allowed, or the config that`,
    `#         unblocks pushing can never itself be pushed." testdecl above was`,
    `#         read from the OLD base ref, so the one push that ADDS a missing`,
    `#         declaration (or replaces a dishonest "none") would otherwise be`,
    `#         judged by the very state it corrects. Recognized narrowly: EVERY`,
    `#         changed path must be one clud-bug itself owns as install/config`,
    `#         mechanism — the declaration file, and the settings file the`,
    `#         commit-review hook is merged into (init/update can write both in`,
    `#         the SAME bootstrap commit: e.g. \`--hook-trigger both\` merges the`,
    `#         commit hook into .claude/settings.json and declares "tests" in`,
    `#         one run — the original one-file check never fired for that real`,
    `#         flow, wedging exactly the push §6.7 says must be allowed). Widened`,
    `#         to this fixed pair, not to .claude/ broadly: neither file can`,
    `#         carry user feature content, so the anti-smuggling property the`,
    `#         "also changes other files" case below tests still holds. Multi-ref`,
    `#         pushes share $range's existing first-ref-only limitation (see`,
    `#         "N refs were pushed" below) — not widened here.`,
    `declonlychange=0`,
    `if [ -n "$range" ]; then`,
    `  changedpaths=$(git diff --name-only "$range" 2>/dev/null </dev/null) || changedpaths=`,
    `  if [ -n "$changedpaths" ]; then`,
    `    declonlychange=1`,
    `    while IFS= read -r changedpath; do`,
    `      case "$changedpath" in`,
    `        .claude/skills/.clud-bug.json|.claude/settings.json) ;;`,
    `        *) declonlychange=0 ;;`,
    `      esac`,
    `    done <<CLUD_BUG_CHANGED`,
    `$changedpaths`,
    `CLUD_BUG_CHANGED`,
    `  fi`,
    `fi`,
    `allowexempt=0`,
    `if [ "$declonlychange" = 1 ] && { [ -z "$testdecl" ] || [ "$testdecl" = "none" ]; }; then`,
    `  allowexempt=1`,
    `fi`,
    ``,
    `# --- 3c. the verdict. "The two failure kinds stay apart... A declaration`,
    `#         missing or contradicted blocks — that is the feature."`,
    `if [ -z "$baseref" ]; then`,
    // 6.5: a gate that could not run must say so rather than exit 0 in silence.
    `  printf 'clud-bug: no default-branch ref for remote %s — mechanical check skipped (6.7: a gate that cannot resolve its configuration allows).\\n' "$remote" >&2`,
    // #319 CRITICAL — checked BEFORE the exemption/declaration branches below
    // so a node failure always gets ITS OWN message, never one that happens
    // to also fit the (unreliable) partial state a broken parse left behind.
    `elif [ "$nodeerror" = 1 ]; then`,
    `  printf 'clud-bug: could not read the "tests" declaration — the node binary needed to parse .claude/skills/.clud-bug.json (or package.json, for suite detection) failed or is unavailable. SPEC 6.7: an engine that cannot resolve its configuration allows; a broken binary MUST NOT be able to wedge a push. Mechanical check skipped.\\n' >&2`,
    `elif [ "$allowexempt" = 1 ]; then`,
    `  printf 'clud-bug: this push only changes clud-bug local-gate config (.claude/skills/.clud-bug.json and/or .claude/settings.json) — allowed regardless of the state it replaces (SPEC 6.7: the config that unblocks pushing must itself be pushable).\\n' >&2`,
    `elif [ -z "$testdecl" ]; then`,
    `  if [ "$suitedetected" = 1 ]; then`,
    `    printf 'clud-bug: PUSH BLOCKED — %s has test files but no "tests" declaration. SPEC 6.7: a repository with a detected suite that is not run blocks. Add "tests": "<command>" to .claude/skills/.clud-bug.json on the default branch, then push again.\\n' "$baseref" >&2`,
    `  else`,
    `    printf 'clud-bug: PUSH BLOCKED — %s has no "tests" declaration. SPEC 6.7 requires one: add "tests": "<command>" (or "tests": "none" if there truly is no suite) to .claude/skills/.clud-bug.json on the default branch, then push again.\\n' "$baseref" >&2`,
    `  fi`,
    `  exit 1`,
    `elif [ "$testdecl" = "none" ]; then`,
    `  if [ "$suitedetected" = 1 ]; then`,
    `    printf 'clud-bug: PUSH BLOCKED — %s declares "tests": "none" but has test files. SPEC 6.7: a "none" declaration that contradicts the repository blocks. Declare the real command in .claude/skills/.clud-bug.json on the default branch, then push again.\\n' "$baseref" >&2`,
    `    exit 1`,
    `  fi`,
    `  printf 'clud-bug: %s declares "tests": "none" — no mechanical check to run.\\n' "$baseref" >&2`,
    `else`,
    `  printf 'clud-bug: pre-push mechanical check (6.7 — tests before review): %s\\n' "$testdecl" >&2`,
    `  sh -c "$testdecl" >&2 </dev/null`,
    `  teststatus=$?`,
    `  if [ "$teststatus" -ne 0 ]; then`,
    `    printf 'clud-bug: PUSH BLOCKED — the declared test command exited %s. SPEC 6.7: a failing mechanical check blocks and the model does not run. Fix the tests, then push again.\\n' "$teststatus" >&2`,
    `    exit 1`,
    `  fi`,
    `fi`,
    ``,
    `# --- 4. the model half. ADVISORY: printed, never blocking (4.1). No network`,
    `#        happens here — see the buildPrePushHookScript header for why.`,
    `cmd="npx clud-bug@${pin} review-prompt --trigger push"`,
    // No computable base (a root-commit push, or a remote with no default head)
    // — omit --range and let the recipe fall back to its own branch-vs-base diff
    // rather than fabricate a range that would review the wrong thing.
    `if [ -n "$range" ]; then`,
    `  cmd="$cmd --range $range"`,
    `else`,
    `  printf 'clud-bug: could not compute the pushed range — the recipe will fall back to diffing this branch against its base.\\n' >&2`,
    `fi`,
    `printf 'clud-bug pre-push review (max mode — runs on this session subscription, nothing billed).\\n' >&2`,
    `printf 'The push is NOT blocked (SPEC 4.1: the local review is advisory). Run this now and act on what it finds:\\n\\n  %s\\n\\n' "$cmd" >&2`,
    `printf 'Then follow the recipe it prints: review that range against the skills it names and surface the findings here. This is a LOCAL run — post nothing, write no file (SPEC 4.3).\\n' >&2`,
    `if [ "$nrefs" -gt 1 ]; then`,
    `  printf 'clud-bug: %s refs were pushed; the range above covers the first. Re-run review-prompt with --range for the others.\\n' "$nrefs" >&2`,
    `fi`,
    `exit 0`,
  ].join('\n') + '\n';
}

/** What `clud-bug init` / `clud-bug update` should do about `pre-push`. */
export interface PrePushInstallPlan {
  /**
   * - `write`   — no hook there; write ours.
   * - `refresh` — ours is already there; replace it in place.
   * - `chain`   — a FOREIGN hook is there; move it to `moveExistingTo` and
   *               write ours, which invokes it first (§6.7).
   * - `skip`    — refuse rather than risk destroying user content.
   */
  action: 'write' | 'refresh' | 'chain' | 'skip';
  /** The script to write. Absent on `skip`. */
  content?: string;
  /** `chain` only — the basename the existing hook must be moved to first. */
  moveExistingTo?: string;
  /** One line, suitable for `log()` / a warning. */
  reason: string;
}

/**
 * Decide how to install the `pre-push` hook without ever clobbering a hook
 * clud-bug did not write. Pure — the caller does the fs work, exactly like
 * `mergeLocalReviewHook` leaves the settings.json write to `main.ts`.
 *
 * Idempotent: re-running against our own hook yields `refresh`, so a version
 * bump rewrites the script and a `chain` never happens twice (the chained file
 * stays put across refreshes, and the script finds it by a fixed basename).
 */
export function planPrePushInstall(input: {
  /** Current content of `<hooks>/pre-push`, or undefined when absent. */
  existing?: string | undefined;
  /** Whether `<hooks>/pre-push.clud-bug-chained` already exists. */
  chainedExists?: boolean;
  script: string;
}): PrePushInstallPlan {
  const { existing, chainedExists = false, script } = input;

  if (existing === undefined || existing.trim() === '') {
    return { action: 'write', content: script, reason: 'no existing pre-push hook' };
  }
  if (existing.includes(CLUD_BUG_PREPUSH_MARKER)) {
    return { action: 'refresh', content: script, reason: 'refreshed the clud-bug pre-push hook in place' };
  }
  if (chainedExists) {
    // Two foreign hooks would have to be preserved and only one slot exists to
    // preserve them in. Refuse — a lost user hook is unrecoverable; a skipped
    // install is not.
    return {
      action: 'skip',
      reason:
        `a foreign pre-push hook is installed AND ${PREPUSH_CHAINED_FILE} already exists — ` +
        `refusing to overwrite either. Resolve by hand, then re-run.`,
    };
  }
  return {
    action: 'chain',
    content: script,
    moveExistingTo: PREPUSH_CHAINED_FILE,
    reason:
      `preserved your existing pre-push hook as ${PREPUSH_CHAINED_FILE} and chained to it ` +
      `(SPEC 6.7: the owner MUST invoke the other)`,
  };
}

// ---------------------------------------------------------------------------
// #319 — the setup-time half of §6.7: "A repository states whether it has a
// test suite and how to run it. Setup MUST ask, and MUST NOT complete
// without an answer." Now that a missing declaration BLOCKS a push (above),
// leaving `init` silent about it would wedge the very first push a fresh
// install makes — the exact wedge #276's own trailing comment flagged.

export interface TestsDeclarationResult {
  /** The value to persist as `manifest.tests` — always a command or the
   * literal `"none"`, NEVER absent (§6.7: "Setup MUST ask, and MUST NOT
   * complete without an answer" — a non-interactive `init` that could still
   * leave the manifest undeclared would violate that on its own accept-all
   * path). CRITICAL #319 fix: `acceptAll` with nothing detected used to
   * return `null` here and skip the manifest write entirely — the hook this
   * same `init` run installs then blocks the very first push on "nothing
   * declared", a trap a non-interactive setup can never see coming. §6.7's
   * own table makes `no suite detected` + `"none"` declared a PASS: writing
   * `"none"` in that cell is the HONEST declaration the local detectors
   * actually support, not the dishonest one the table reserves for the `yes`
   * rows (a suite the detector CAN see, declared away). */
  value: string;
  source: 'accept-all-detected' | 'accept-all-undeclared' | 'user-entered' | 'user-accepted-default';
}

/**
 * Resolves the `tests` declaration at `init` time. ALWAYS returns a real
 * value — this is what "MUST NOT complete without an answer" means
 * operationally: the manifest is never left with `tests` unset once this
 * returns, on ANY path, interactive or not.
 *
 * `ask` is INJECTED, never imported here — this function does no terminal
 * I/O itself, so it is a plain async function callers (and tests) can invoke
 * directly with a canned responder, no real stdin required. `detected` is
 * the caller's own best-effort suggestion (`detectPackageTestScript` in
 * `../core/detect.js`, run against the WORKING TREE at init time — never
 * used to gate a push; only the base-ref read inside the hook script does
 * that, per §6.3).
 */
export async function resolveTestsDeclaration(input: {
  acceptAll: boolean;
  detected: string | null;
  ask: (question: string) => Promise<string>;
}): Promise<TestsDeclarationResult> {
  const { acceptAll, detected, ask } = input;
  // --accept-all never prompts (matches the existing branch-protection
  // pattern). A real detected command is evidence, safe to accept
  // automatically. Nothing detected is ALSO an answer, not a skipped
  // question: §6.7's table makes "no suite detected" + "none" declared a
  // PASS, so "none" here is the honest declaration these local, no-network
  // detectors actually support — never a blind guess. (The table's dishonest
  // cell is "yes" + "none" — a suite the detector CAN see, declared away.
  // This init-time signal is narrower than the hook's own push-time
  // detection — see `detectPackageTestScript` — so a suite it missed can
  // still surface at push time; the hook's base-ref detection blocks THAT
  // push on the merits, naming the contradiction, never silently. That
  // possible follow-up block is strictly better than the guaranteed one
  // `null` used to leave behind — see the #319 test file for both.)
  if (acceptAll) {
    return detected
      ? { value: detected, source: 'accept-all-detected' }
      : { value: 'none', source: 'accept-all-undeclared' };
  }
  const suggestion = detected ? `"${detected}"` : '"none"';
  const answer = (
    await ask(
      `  Test command to run before every push? [${suggestion}] (type "none" if there truly is no suite): `,
    )
  ).trim();
  if (answer) return { value: answer, source: 'user-entered' };
  // Blank answer accepts the bracketed default — the same convention this
  // file's own [Y/n] prompt (runInitBranchProtection, main.ts) already uses.
  return { value: detected ?? 'none', source: 'user-accepted-default' };
}
