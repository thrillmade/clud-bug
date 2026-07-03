import type { Metadata } from 'next';

const REPO_URL = 'https://github.com/thrillmade/clud-bug';

export const metadata: Metadata = {
  title: 'Configuration — Clud Bug docs',
  description:
    'Every .clud-bug.json option, with a small example each: strictMode, reviewContext, reviewPasses, design, autoResolve, and the executable invariants — grounded in the modules that read them.',
  alternates: { canonical: '/docs/config' },
};

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
            Everything Clud Bug reads from a repository lives in one optional
            file — <code>.clud-bug.json</code> at the root. Six blocks, each with
            a safe default when absent, each grounded in a module you can open.
          </p>
        </header>

        <div className="doc-body">
          <p>
            No block is required; an empty file, or no file at all, gives you the
            defaults below. Each option maps to a module in{' '}
            <a href={`${REPO_URL}/tree/main/src/core`} rel="noopener">
              src/core
            </a>{' '}
            that reads and normalizes it — a malformed value is tolerated and
            falls back to its default rather than failing the review.
          </p>

          <table className="doc-table">
            <thead>
              <tr>
                <th>Block</th>
                <th>Default</th>
                <th>What it governs</th>
              </tr>
            </thead>
            <tbody>
              <tr>
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
                  <code>reviewContext</code>
                </td>
                <td>none</td>
                <td>Trusted standing instructions that focus the review.</td>
              </tr>
              <tr>
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
                  <code>design</code>
                </td>
                <td>off</td>
                <td>The optional visual design-critic pass.</td>
              </tr>
              <tr>
                <td>
                  <code>autoResolve</code>
                </td>
                <td>verified</td>
                <td>How prior threads are re-checked on a fix-push.</td>
              </tr>
              <tr>
                <td>
                  <code>invariants</code>
                </td>
                <td>off</td>
                <td>Executable probes that ground a finding by running RED.</td>
              </tr>
            </tbody>
          </table>

          <h2>strictMode</h2>
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

          <h2>reviewContext</h2>
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

          <h2>reviewPasses</h2>
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

          <h2>design</h2>
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
            check red. <code>themes</code> defaults to both light and dark;{' '}
            <code>viewports</code> to a single desktop width. A missing or
            malformed block resolves to the off default, so a typo can never
            silently enable the render (see{' '}
            <a href={`${REPO_URL}/blob/main/src/core/design.ts`} rel="noopener">
              src/core/design.ts
            </a>
            ).
          </p>

          <h2>autoResolve</h2>
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

          <h2>invariants</h2>
          <p>
            The executable-probe field. An invariant is a behavioral property
            paired with a shell <code>probe</code> that exits non-zero when the
            property is violated. Where <code>reviewContext</code> is checked{' '}
            <em>statically</em> against the diff, a probe is <em>run</em> — so it
            can ground a bug that lives on no single changed line. A finding fires
            only when a probe comes back RED, and that RED output stands equal to
            a quoted diff line.
          </p>
          <pre>
            <code>{`{
  "invariants": [
    {
      "name": "the CLI prints usage without a network call",
      "appliesTo": ["src/cli/**"],
      "probe": "node dist/cli.js --help",
      "expect": "usage: clud-bug"
    }
  ]
}`}</code>
          </pre>
          <p>
            Each invariant carries a <code>name</code> (shown in the probe-results
            block and any finding), one or more <code>appliesTo</code> globs over
            the changed paths (the probe runs only when the diff hits one), the{' '}
            <code>probe</code> command itself, and an optional <code>expect</code>{' '}
            golden reference. Declaring at least one valid invariant is the opt-in;
            the block is off until then. An explicit <code>enabled: false</code>{' '}
            on the wrapper form is a kill-switch that retains the set while turning
            probes off:
          </p>
          <pre>
            <code>{`{
  "invariants": {
    "enabled": false,
    "list": [ { "name": "…", "appliesTo": ["…"], "probe": "…" } ]
  }
}`}</code>
          </pre>
          <p>
            Probes run only on a pull request, and only on trusted work — the
            reviewer never executes a probe exercised by an untrusted diff. The
            config and its gate live in{' '}
            <a href={`${REPO_URL}/blob/main/src/core/invariants.ts`} rel="noopener">
              src/core/invariants.ts
            </a>
            ; why RED output grounds a finding as firmly as a quoted line is the
            subject of <a href="/docs/multi-pass">the multi-pass entry</a>.
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
