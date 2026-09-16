import type { Metadata } from 'next';

const REPO_URL = 'https://github.com/thrillmade/clud-bug';

export const metadata: Metadata = {
  title: 'Configuration — Clud Bug docs',
  description:
    'Every setting clud-bug reads, how to set it with `clud-bug config`, and which ones only a person may change — grounded in the modules that read them.',
  alternates: { canonical: '/docs/config' },
};

// Kept byte-identical to HONEST_GUARANTEE in src/core/config-schema.ts, which
// owns the claim; test/config-docs.test.js fails if the two ever differ.
const HONEST_GUARANTEE =
  `This refusal only stops a tool that asks. Nothing stops an agent that writes the file directly — no local check can. What holds instead is the pair SPEC §1.6 names: a gate reads its settings from the pull request's base ref (§6.3), so an edit inside a pull request has no effect on the gate judging it, and the edit is a hunk in a diff a review reads like any other.`;

export default function DocsConfig() {
  return (
    <main className="page">
      <header className="folio">
        <span>A Field Guide to Code Specimens</span>
        <span>Configuration · MMXXVI</span>
      </header>

      <div className="doc">
        <a className="doc-back" href="/docs">← Field manual</a>

        <header className="doc-head">
          <span className="doc-eyebrow">§ Configuration</span>
          <h1 className="doc-title">The manifest.</h1>
          <p className="doc-lede">
            Everything Clud Bug reads from a repository lives in one file —{' '}
            <code>.claude/skills/.clud-bug.json</code>. Nobody needs to open it:{' '}
            <code>clud-bug config</code> sets every setting by name, refuses a
            value a setting cannot take, and tells you what it can.
          </p>
        </header>

        <div className="doc-body">
          <p>
            Nothing is required; an empty file, or no file at all, gives you the
            defaults below. Each setting maps to a module in{' '}
            <a href={`${REPO_URL}/tree/main/src/core`} rel="noopener">
              src/core
            </a>{' '}
            that reads and normalizes it — a malformed value is tolerated and
            falls back to its default rather than failing the review, and a key
            this version has never heard of is round-tripped untouched.
          </p>

          <h2>clud-bug config</h2>
          <pre>
            <code>{`clud-bug config list                       # every setting, its value, where it came from
clud-bug config get review.ci_checks       # one value (add --json for the record)
clud-bug config set review.ci_checks '["build","typecheck"]'
clud-bug config unset review.ci_checks     # back to the documented default`}</code>
          </pre>
          <p>
            The same command in a terminal and in a workflow: nothing here reads
            a TTY, <code>CI</code>, or any agent marker. Exit codes are the
            contract a script reads — <code>0</code> done, <code>1</code> a file
            that could not be read or written (it is left exactly as it was),{' '}
            <code>2</code> no such setting (with a did-you-mean), <code>3</code>{' '}
            a value outside the domain, <code>4</code> refused.
          </p>

          <h2>Every setting</h2>
          <p>
            The left column is the name you type. The middle is where the value
            lands in the file, which is camelCase for historical reasons and is
            the only place those two spellings meet.
          </p>

          <table className="doc-table">
            <thead>
              <tr>
                <th>Setting</th>
                <th>On disk</th>
                <th>Default</th>
                <th>What it governs</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>review.strict_mode</code> <strong>humans only</strong>
                </td>
                <td>
                  <code>strictMode</code>
                </td>
                <td>
                  <code>false</code>
                </td>
                <td>Whether a critical finding blocks the merge or only advises.</td>
              </tr>
              <tr>
                <td>
                  <code>review.ci_checks</code>
                </td>
                <td>
                  <code>ciChecks</code>
                </td>
                <td>every check</td>
                <td>Narrows which CI checks a review reads as evidence.</td>
              </tr>
              <tr>
                <td>
                  <code>review.trigger</code>
                </td>
                <td>
                  <code>reviewTrigger</code>
                </td>
                <td>
                  <code>push</code>
                </td>
                <td>Whether the local review runs after a commit or before a push.</td>
              </tr>
              <tr>
                <td>
                  <code>review.auto_fix</code> <strong>humans only</strong>
                </td>
                <td>
                  <code>autoFix</code>
                </td>
                <td>unset</td>
                <td>
                  Whether a reviewer may push a fix, and how many rounds. Read by the hosted App;
                  the CLI does not push fixes.
                </td>
              </tr>
              <tr>
                <td>
                  <code>review.auto_resolve</code>
                </td>
                <td>
                  <code>autoResolve</code>
                </td>
                <td>verified</td>
                <td>How prior threads are re-checked on a fix-push.</td>
              </tr>
              <tr>
                <td>
                  <code>review.passes</code>
                </td>
                <td>
                  <code>reviewPasses</code>
                </td>
                <td>
                  <code>1</code> · cross-check
                </td>
                <td>How many passes run and how their findings are aggregated.</td>
              </tr>
              <tr>
                <td>
                  <code>review.passes.blocking</code> <strong>humans only</strong>
                </td>
                <td>
                  <code>reviewPasses.blocking</code>
                </td>
                <td>none</td>
                <td>Which passes turn the check red.</td>
              </tr>
              <tr>
                <td>
                  <code>tests</code>
                </td>
                <td>
                  <code>tests</code>
                </td>
                <td>unset</td>
                <td>
                  The command run before every push, or <code>none</code>.
                </td>
              </tr>
              <tr>
                <td>
                  <code>review_context</code>
                </td>
                <td>
                  <code>reviewContext</code>
                </td>
                <td>none</td>
                <td>Trusted standing instructions that focus the review.</td>
              </tr>
              <tr>
                <td>
                  <code>review.cost_cap_usd</code>
                </td>
                <td>
                  <code>perPrCapUsd</code>
                </td>
                <td>unset</td>
                <td>
                  Cumulative USD ceiling per pull request. Unset means no
                  ceiling — and nothing enforces it yet, so setting it changes
                  nothing today.
                </td>
              </tr>
              <tr>
                <td>
                  <code>review.strict_skills</code> <strong>humans only</strong>
                </td>
                <td>
                  <code>strictSkills</code>
                </td>
                <td>none</td>
                <td>Skills that get their own required check-run.</td>
              </tr>
              <tr>
                <td>
                  <code>review.notary</code>
                </td>
                <td>
                  <code>notary</code>
                </td>
                <td>
                  <code>true</code>
                </td>
                <td>Whether a local review certifies through the notary, or self-attests.</td>
              </tr>
              <tr>
                <td>
                  <code>design.enabled</code>
                </td>
                <td>
                  <code>design.enabled</code>
                </td>
                <td>
                  <code>false</code>
                </td>
                <td>Whether the visual design pass runs at all.</td>
              </tr>
              <tr>
                <td>
                  <code>design.gate</code> <strong>humans only</strong>
                </td>
                <td>
                  <code>design.gate</code>
                </td>
                <td>advisory</td>
                <td>Whether a design critical blocks the merge.</td>
              </tr>
              <tr>
                <td>
                  <code>design.themes</code> · <code>design.viewports</code>
                </td>
                <td>
                  <code>design.themes</code> · <code>design.viewports</code>
                </td>
                <td>light + dark · desktop</td>
                <td>What the design pass renders.</td>
              </tr>
              <tr>
                <td>
                  <code>pin_version</code>
                </td>
                <td>
                  <code>pinVersion</code>
                </td>
                <td>unset</td>
                <td>Pin clud-bug to one version and stop the weekly self-update PRs.</td>
              </tr>
              <tr>
                <td>
                  <code>excluded_baselines</code>
                </td>
                <td>
                  <code>excludedBaselines</code>
                </td>
                <td>none</td>
                <td>Baseline skills this repository removed and does not want back.</td>
              </tr>
            </tbody>
          </table>

          <h2>The settings only a person may change</h2>
          <p>
            A setting that decides whether something <em>blocks</em> is a
            person&rsquo;s to change, never an agent&rsquo;s — SPEC §1.6. Asked
            to set one, <code>clud-bug config</code> refuses with exit{' '}
            <code>4</code>, names the section, and points at the hand edit a
            person makes on the default branch. What that buys is worth stating
            exactly:
          </p>
          <p>{HONEST_GUARANTEE}</p>
          <p>
            Everything else an agent may set: registering a skill it just wrote,
            declaring the test command, narrowing a noisy CI check. Those are
            legitimate work, and blocking them helps nobody.
          </p>

          <h2>review.strict_mode</h2>
          <p>
            A boolean gate on merges. When a review turns up a{' '}
            <code>critical</code> finding, <code>strictMode: true</code> makes the{' '}
            <code>clud-bug-review</code> check fail — branch protection blocks the
            merge until the finding is resolved. Left off (the default), the same
            finding posts as an advisory: the check goes <em>neutral</em>, never
            red, and the merge is never blocked.
          </p>
          <pre>
            <code>{`{
  "strictMode": true
}`}</code>
          </pre>
          <p>
            This one is edited by hand on purpose: <code>clud-bug config set
            review.strict_mode</code> refuses, because a setting that decides
            whether something blocks is a person&rsquo;s to change. Fresh
            installs get <code>true</code> from <code>clud-bug init</code>;
            turning it off is your edit to make.
          </p>
          <p>
            The value is read from the pull request&rsquo;s <strong>base ref</strong>{' '}
            — the branch being merged into, not the PR&rsquo;s own head — so a
            pull request cannot disable strict mode on itself in the same diff.
            The mapping from verdict to check conclusion lives in{' '}
            <a href={`${REPO_URL}/blob/main/src/core/check-verdict.ts`} rel="noopener">
              src/core/check-verdict.ts
            </a>
            : clean is <em>success</em>, critical under strict mode is{' '}
            <em>failure</em>, and a review that could not run is <em>neutral</em>{' '}
            — the bot never blocks a merge on its own inability to run.
          </p>

          <h2>review_context</h2>
          <p>
            Standing, repo-level guidance that focuses every review — &ldquo;scrutinize
            the auth migration&rdquo;, &ldquo;the generated files under{' '}
            <code>gen/</code> are intentional&rdquo;. Because it is committed to the
            manifest by a maintainer and read from the base ref, it is{' '}
            <strong>trusted</strong>: it may direct the review freely.
          </p>
          <pre>
            <code>{`{
  "reviewContext": "Scrutinize any change under src/auth/**. The files under gen/ are generated and intentional — do not flag them for style."
}`}</code>
          </pre>
          <p>
            The object form is equivalent, and is the shape to reach for when you
            want the key to read as a block:
          </p>
          <pre>
            <code>{`{
  "reviewContext": { "instructions": "Prefer table-driven tests for parsers." }
}`}</code>
          </pre>
          <p>
            The text is trimmed and capped at 4&nbsp;KB so a runaway config cannot
            dominate the prompt (see{' '}
            <a href={`${REPO_URL}/blob/main/src/core/review-context.ts`} rel="noopener">
              src/core/review-context.ts
            </a>
            ). This trusted channel is distinct from the{' '}
            <strong>untrusted</strong> per-PR marker: a{' '}
            <code>&lt;!-- clud-bug: … --&gt;</code> comment in a pull request&rsquo;s{' '}
            <em>description</em> may point the review at a file, but it is fenced
            so it can never suppress a finding, lower a severity, relax a skill,
            or touch the merge gate. Whoever opens the PR authors that marker, so
            it is treated as a hint, never an instruction.
          </p>

          <h2>review.passes</h2>
          <p>
            Configures the multi-pass plan — how many independent passes the
            reviewer runs per skill, and how their findings are aggregated. Two
            layouts are accepted. The flat form sets one repo-wide policy:
          </p>
          <pre>
            <code>{`{
  "reviewPasses": {
    "count": 2,
    "mode": "cross-check",
    "applyTo": "all"
  }
}`}</code>
          </pre>
          <p>
            The split form sets a default and overrides individual skills — useful
            when one skill (a security audit, say) earns deeper scrutiny than the
            rest:
          </p>
          <pre>
            <code>{`{
  "reviewPasses": {
    "default": { "count": 1, "mode": "cross-check" },
    "perSkill": { "security-audit": { "count": 3 } }
  }
}`}</code>
          </pre>
          <p>
            <code>count</code> is clamped to a hard ceiling of{' '}
            <strong>three</strong> passes; there is no escape hatch, since a
            fourth Claude call per skill is where cost turns user-hostile.{' '}
            <code>mode</code> is <code>cross-check</code> (the default),{' '}
            <code>consensus</code>, or <code>independent</code>;{' '}
            <code>applyTo</code> may be narrowed to <code>shared-only</code> so
            only shared skills multi-pass. Precedence runs perSkill → the skill&rsquo;s
            own <code>review_passes</code> frontmatter → the repo default →
            the built-in single pass, resolved in{' '}
            <a href={`${REPO_URL}/blob/main/src/core/review-plan.ts`} rel="noopener">
              src/core/review-plan.ts
            </a>
            . What the modes actually mean is the subject of{' '}
            <a href="/docs/multi-pass">the multi-pass entry</a>.
          </p>

          <h2>design.enabled</h2>
          <p>
            An optional visual review. When enabled, the bot renders each changed
            UI surface on the pull request&rsquo;s deploy-preview and critiques the
            screenshots against your <code>kind: design</code> skills. It is off
            by default and gated tightly — it only ever runs, and only ever costs,
            on a repo that opted in, with at least one design skill installed, on
            a pull request.
          </p>
          <pre>
            <code>{`{
  "design": {
    "enabled": true,
    "gate": "advisory",
    "themes": ["light", "dark"],
    "viewports": ["desktop", "mobile"]
  }
}`}</code>
          </pre>
          <p>
            <code>gate</code> is <code>advisory</code> by default — design
            findings post as comments and never block. Set it to{' '}
            <code>strict</code> to make a design <code>critical</code> turn the
            check red — by hand, because <code>design.gate</code> decides
            whether something blocks and the command refuses it. <code>themes</code> defaults to both light and dark;{' '}
            <code>viewports</code> to a single desktop width. A missing or
            malformed block resolves to the off default, so a typo can never
            silently enable the render (see{' '}
            <a href={`${REPO_URL}/blob/main/src/core/design.ts`} rel="noopener">
              src/core/design.ts
            </a>
            ).
          </p>

          <h2>review.auto_fix</h2>
          <p>
            SPEC 2.0 §4.6: whether a reviewer may push a fix for its own
            finding, and how many rounds. Only the hosted App implements the
            push — this key exists so it is settable and humans-only
            (§1.6:262) under the exact name SPEC names, even though the OSS
            CLI never reads it. See <code>review.auto_resolve</code> below for
            the thing this CLI actually does on a fix-push.
          </p>

          <h2>review.auto_resolve</h2>
          <p>
            Governs what happens on a fix-push. For each open thread the bot
            raised on a prior pass, it re-verifies whether the new commit
            addressed the original concern, then resolves, keeps open, or
            escalates it.
          </p>
          <pre>
            <code>{`{
  "autoResolve": {
    "mode": "verified",
    "uncertain_critical_action": "request_changes"
  }
}`}</code>
          </pre>
          <p>
            <code>mode</code> is <code>verified</code> (the default — call the
            per-thread verifier) or <code>off</code> (leave every thread open,
            make no verifier calls). <code>uncertain_critical_action</code>{' '}
            decides the one genuinely hazardous case: a verifier that is{' '}
            <em>uncertain</em> about a critical finding. Left at{' '}
            <code>request_changes</code>, that thread is kept open and escalated;{' '}
            <code>leave_open</code> keeps it open with a milder note. A critical
            is never silently dismissed either way. The rule table lives in{' '}
            <a href={`${REPO_URL}/blob/main/src/core/auto-resolve.ts`} rel="noopener">
              src/core/auto-resolve.ts
            </a>{' '}
            and is walked through in{' '}
            <a href="/docs/auto-fix">the auto-fix entry</a>.
          </p>

          <h2>review.ci_checks</h2>
          <p>
            The reviewer never executes anything of its own — no probe, no
            build, no test run against the diff. Where{' '}
            <code>reviewContext</code> is checked <em>statically</em> and a
            skill quotes a line, the strongest evidence available beyond that
            is a CI check the repository&rsquo;s own forge already ran. This is on
            by default: every check that ran against the commit is fair game,
            and a concluded failure grounds a finding exactly as a quoted diff
            line does.
          </p>
          <pre>
            <code>{`clud-bug config set review.ci_checks '["build","typecheck"]'`}</code>
          </pre>
          <pre>
            <code>{`{
  "ciChecks": ["build", "typecheck"]
}`}</code>
          </pre>
          <p>
            An array narrows the reviewer to those named checks — useful for a
            repo with a flaky job, or a deploy preview that fails by design.
            Leave the key out and every check is read. Set it to an explicit
            empty array and the reviewer reads none of them; that is the only
            way to switch this off, and a repo that does is choosing to have
            its reviews reason about code without knowing whether it runs.
          </p>
          <p>
            A check that has not finished is not a check that passed — the
            reviewer reports what it covers as <code>unverified</code> rather
            than clean, and never blocks waiting for it. The config and its
            gate live in{' '}
            <a href={`${REPO_URL}/blob/main/src/core/ci-checks.ts`} rel="noopener">
              src/core/ci-checks.ts
            </a>
            ; why a failed check grounds a finding as firmly as a quoted line
            is the subject of <a href="/docs/multi-pass">the multi-pass entry</a>.
          </p>
        </div>

        <a className="doc-back" href="/docs">← Back to the field manual</a>
      </div>

      <footer className="colophon">
        <span>
          Open source.{' '}
          <a href="https://github.com/thrillmade/clud-bug/blob/main/LICENSE">MIT</a>.
        </span>
        <span className="credit">
          a{' '}
          <a href="https://thrillmot.com" rel="noopener">
            thrillmot
          </a>{' '}
          project
        </span>
        <span>
          <a href="/docs">docs</a>
          {' · '}
          <a href="/docs/skills">skills</a>
        </span>
      </footer>
    </main>
  );
}
