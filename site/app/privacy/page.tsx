import type { Metadata } from 'next';

const ISSUES_URL = 'https://github.com/thrillmade/clud-bug-app/issues';
const SECURITY_URL = 'https://github.com/thrillmade/clud-bug-app/security/advisories/new';
const APP_REPO_URL = 'https://github.com/thrillmade/clud-bug-app';

export const metadata: Metadata = {
  title: 'Privacy & data handling — Clud Bug',
  description:
    'What the clud-bug GitHub App reads, what it sends to Anthropic, what we retain, and how to delete it. Cost-plus on data too: we keep as little as the job needs.',
  alternates: { canonical: '/privacy' },
};

export default function Privacy() {
  return (
    <main className="page">
      <header className="folio">
        <span>A Field Guide to Code Specimens</span>
        <span>Privacy · MMXXVI</span>
      </header>

      <div className="doc">
        <a className="doc-back" href="/">← Field guide</a>

        <header className="doc-head">
          <span className="doc-eyebrow">§ Data Handling</span>
          <h1 className="doc-title">Privacy &amp; data handling.</h1>
          <p className="doc-lede">
            clud-bug reads each pull request&rsquo;s diff and your skill files,
            sends them to Anthropic for review, and writes the result back to
            the PR. We retain almost nothing — only short-lived idempotency keys
            and your per-install configuration.
          </p>
        </header>

        <p className="doc-status">
          <strong>Last updated: June 2026.</strong> This describes the
          data handling of the hosted <code>clud-bug[bot]</code> GitHub App. The
          App&rsquo;s entire source is open — every data path below is auditable
          at <a href={APP_REPO_URL} rel="noopener">github.com/thrillmade/clud-bug-app</a>.
        </p>

        <div className="doc-body">
          <h2>1. What the App reads</h2>
          <p>
            On install, the GitHub App receives an installation access token
            scoped to these permissions — and no others:
          </p>
          <table className="doc-table">
            <thead>
              <tr><th>Permission</th><th>Why</th></tr>
            </thead>
            <tbody>
              <tr><td><code>pull_requests: write</code></td><td>Read PR metadata + diff; post the inline review threads and the summary comment; resolve threads on verified fixes.</td></tr>
              <tr><td><code>contents: write</code></td><td>Read skill manifests at the PR&rsquo;s base ref; push auto-fix commits (only when explicitly enabled per-install).</td></tr>
              <tr><td><code>checks: write</code></td><td>Post a check-run so the PR&rsquo;s status reflects the review verdict.</td></tr>
              <tr><td><code>issues: write</code></td><td>Post the summary as a top-level PR comment (GitHub treats these as issue comments).</td></tr>
              <tr><td><code>metadata: read</code></td><td>Required for any install; read-only repo metadata (name, default branch).</td></tr>
            </tbody>
          </table>
          <p>
            We do <strong>not</strong> request <code>administration</code>,{' '}
            <code>secrets</code>, <code>actions</code>, <code>members</code>, or
            any org-admin scopes. The token is scoped per installation —
            uninstalling revokes it.
          </p>

          <h2>2. What we send to Anthropic</h2>
          <p>For each review, the App sends to Anthropic&rsquo;s API:</p>
          <ul>
            <li>The PR&rsquo;s <strong>unified diff</strong> (what <code>git diff base...head</code> produces).</li>
            <li>The <strong>bodies of the skill files</strong> resolved for that review (from <code>.claude/skills/</code> at the base ref, plus any catalog skills you opted into).</li>
            <li>A static <strong>system prompt</strong> and the <strong>schema</strong> the reviewer emits findings against.</li>
            <li>The PR metadata needed to attribute comments (number, base/head SHA, file paths).</li>
          </ul>
          <p>
            We do <strong>not</strong> send repository contents outside the
            diff (no full-repo crawl), files at paths not in the diff, or your
            GitHub credentials (Anthropic never sees the installation token).
          </p>
          <p>
            <strong>Visual design review (Team, opt-in).</strong> If you enable
            the design critique, the App resolves your PR&rsquo;s
            already-public <strong>deploy-preview URL</strong> and sends it to
            our render service (Browserless), which loads that preview and
            captures screenshots. The screenshots are sent to Anthropic for the
            visual review. No additional repository content is read or sent.
          </p>

          <h2>3. What Anthropic does with it</h2>
          <p>
            The App calls Anthropic via the{' '}
            <a href="https://vercel.com/docs/ai-gateway" rel="noopener">Vercel AI Gateway</a>.
            Per Anthropic&rsquo;s policy, API requests are <strong>not used to
            train models</strong>. Anthropic retains request data for a limited
            operational window (currently ~30 days for abuse monitoring);
            clud-bug does not access that buffer.
          </p>

          <h2>4. What we retain</h2>
          <p>
            We use <a href="https://upstash.com" rel="noopener">Upstash Redis</a>{' '}
            for configuration and short-lived operational state. None of it
            contains PR diffs or skill bodies.
          </p>
          <table className="doc-table">
            <thead>
              <tr><th>Class</th><th>Contents</th><th>TTL</th></tr>
            </thead>
            <tbody>
              <tr><td>Install config</td><td>Org login, tier / billing mode, skill-catalog config.</td><td>Until uninstall.</td></tr>
              <tr><td>Idempotency keys</td><td>Webhook delivery IDs marked processed (prevents double-reviews).</td><td>≤ 24 hours.</td></tr>
              <tr><td>Usage + spend meters</td><td>Per-review token counts and cost estimates, for billing reconciliation. No content.</td><td>Short-lived (rolling).</td></tr>
              <tr><td>Comment + screenshot cache</td><td>The review comment&rsquo;s ID (to edit in place) and, for the design pass, screenshots keyed by commit SHA.</td><td>≤ 1 hour (screenshots).</td></tr>
            </tbody>
          </table>
          <p>
            We do <strong>not</strong> retain PR diffs after a review completes,
            skill manifest bodies (re-fetched each review), inline comment text
            (it lives in GitHub once posted), or authentication tokens (minted
            per-request and discarded).
          </p>

          <h2>5. Where the review is written</h2>
          <p>
            The review is posted to <strong>your PR</strong>: inline review
            threads at the exact lines, plus one summary comment that the bot
            edits in place on each new push (so the conversation stays to a
            single comment, not one per pass). That comment — in your GitHub
            repo, under the App&rsquo;s identity — is the audit trail. We keep no
            copy of its text.
          </p>

          <h2>6. Sub-processors</h2>
          <table className="doc-table">
            <thead>
              <tr><th>Sub-processor</th><th>Purpose</th><th>Region</th></tr>
            </thead>
            <tbody>
              <tr><td><strong>Vercel</strong></td><td>Function execution + logs</td><td>Multi-region (AWS)</td></tr>
              <tr><td><strong>Upstash</strong></td><td>Redis (config + idempotency + meters)</td><td>Multi-region</td></tr>
              <tr><td><strong>Anthropic</strong> (via Vercel AI Gateway)</td><td>LLM inference for the review</td><td>US</td></tr>
              <tr><td><strong>Stripe</strong></td><td>Subscription + metered billing</td><td>US</td></tr>
              <tr><td><strong>Browserless</strong></td><td>Screenshot render for the visual design pass (Team, opt-in only)</td><td>US/EU</td></tr>
              <tr><td><strong>GitHub</strong></td><td>The platform — install, webhooks, comment posting</td><td>Multi-region (Azure)</td></tr>
            </tbody>
          </table>
          <p>
            We use no AI providers other than Anthropic. If that changes, this
            list is updated and installed customers are notified.
          </p>

          <h2>7. Logging</h2>
          <p>
            Vercel function logs capture request route + status, error stack
            traces, and operational lines (install ID, delivery ID, review
            outcome, policy denials). Logs do <strong>not</strong> contain PR
            diff content, skill bodies, or Anthropic responses. They age out per
            Vercel&rsquo;s standard retention (7–30 days).
          </p>

          <h2>8. Data deletion</h2>
          <p>
            <strong>On uninstall:</strong> within 24 hours we purge all Redis
            keys tied to that installation. Idempotency keys age out within 24
            hours regardless.
          </p>
          <p>
            <strong>On request:</strong> open an issue at{' '}
            <a href={ISSUES_URL} rel="noopener">our GitHub Issues</a>, or — for
            anything you&rsquo;d rather not post publicly — a{' '}
            <a href={SECURITY_URL} rel="noopener">private security advisory</a>.
            We respond within 7 business days.
          </p>

          <h2>9. Open source</h2>
          <p>
            The App&rsquo;s codebase is open at{' '}
            <a href={APP_REPO_URL} rel="noopener">github.com/thrillmade/clud-bug-app</a>.
            Trace each data path above by searching the source for the storage
            key prefixes and the Anthropic call site.
          </p>

          <h2>10. Contact</h2>
          <p>
            Privacy questions, data-deletion requests, and security
            disclosures: <a href={ISSUES_URL} rel="noopener">GitHub Issues</a>{' '}
            (public) or a <a href={SECURITY_URL} rel="noopener">private security
            advisory</a> (confidential).
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
          <a href="/terms">terms</a>
        </span>
      </footer>
    </main>
  );
}
