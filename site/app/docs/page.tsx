import type { Metadata } from 'next';

const REPO_URL = 'https://github.com/thrillmade/clud-bug';

export const metadata: Metadata = {
  title: 'Documentation — Clud Bug',
  description:
    'The clud-bug field manual: how review skills work, the .clud-bug.json options, auto-fix and auto-resolve, and the Beetle / Wasp / Mantis multi-pass review.',
  alternates: { canonical: '/docs' },
};

export default function Docs() {
  return (
    <main className="page">
      <header className="folio">
        <span>A Field Guide to Code Specimens</span>
        <span>Documentation · MMXXVI</span>
      </header>

      <div className="doc">
        <a className="doc-back" href="/">← Field guide</a>

        <header className="doc-head">
          <span className="doc-eyebrow">§ Field Manual</span>
          <h1 className="doc-title">The field manual.</h1>
          <p className="doc-lede">
            Four entries on how Clud Bug reviews a pull request — the skills it
            reads, the manifest that configures it, how it verifies and closes
            its own findings, and the three naturalists of a multi-pass review.
          </p>
        </header>

        <div className="doc-body">
          <p>
            Every entry below is grounded in the open source. Each option maps
            to a module you can read at{' '}
            <a href={REPO_URL} rel="noopener">github.com/thrillmade/clud-bug</a>{' '}
            — nothing here is a feature the code doesn&rsquo;t already carry.
            Start anywhere.
          </p>

          <table className="doc-table">
            <thead>
              <tr><th>Entry</th><th>Field notes</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><a href="/docs/skills">Review skills</a></td>
                <td>
                  What a <code>SKILL.md</code> is, how the bot loads one at the
                  PR base ref and cites it by slug, and where the baseline kit
                  and community skills come from.
                </td>
              </tr>
              <tr>
                <td><a href="/docs/config">Configuration</a></td>
                <td>
                  Every <code>.clud-bug.json</code> option —{' '}
                  <code>strictMode</code>, <code>reviewContext</code>,{' '}
                  <code>reviewPasses</code>, <code>design</code>,{' '}
                  <code>autoResolve</code>, and the executable{' '}
                  <code>invariants</code> — with a small example each.
                </td>
              </tr>
              <tr>
                <td><a href="/docs/auto-fix">Auto-fix &amp; auto-resolve</a></td>
                <td>
                  How a fix-push is verified thread-by-thread, and the rule
                  table that resolves, keeps open, or escalates each finding
                  the bot raised.
                </td>
              </tr>
              <tr>
                <td><a href="/docs/multi-pass">Multi-pass review</a></td>
                <td>
                  Beetle, Wasp, and Mantis; the cross-check, consensus, and
                  independent modes; and why a reproduction grounds a finding
                  as firmly as a quoted line.
                </td>
              </tr>
            </tbody>
          </table>

          <p>
            The <a href="/pricing">pricing page</a> covers which tiers unlock
            multi-pass and the design critique. For what the App reads and
            retains, see <a href="/privacy">privacy &amp; data handling</a>.
          </p>
        </div>

        <a className="doc-back" href="/">← Back to the field guide</a>
      </div>

      <footer className="colophon">
        <span>
          Open source. <a href="https://github.com/thrillmade/clud-bug/blob/main/LICENSE">MIT</a>.
        </span>
        <span className="credit">
          a <a href="https://thrillmot.com" rel="noopener">thrillmot</a> project
        </span>
        <span>
          <a href="/pricing">pricing</a>
          {' · '}
          <a href="/privacy">privacy</a>
        </span>
      </footer>
    </main>
  );
}
