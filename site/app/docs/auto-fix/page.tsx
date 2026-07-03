import type { Metadata } from 'next';

const REPO_URL = 'https://github.com/thrillmade/clud-bug';

export const metadata: Metadata = {
  title: 'Auto-fix & auto-resolve — Clud Bug docs',
  description:
    'How a fix-push is re-verified thread by thread: the per-thread verdict (ADDRESSED / NOT_ADDRESSED / UNCERTAIN, fail-closed to human review) and the rule table that resolves, keeps open, or escalates each prior finding.',
  alternates: { canonical: '/docs/auto-fix' },
};

export default function DocsAutoFix() {
  return (
    <main className="page">
      <header className="folio">
        <span>A Field Guide to Code Specimens</span>
        <span>Auto-resolve · MMXXVI</span>
      </header>

      <div className="doc">
        <a className="doc-back" href="/docs">← Field manual</a>

        <header className="doc-head">
          <span className="doc-eyebrow">§ Auto-fix &amp; Auto-resolve</span>
          <h1 className="doc-title">Closing its own findings.</h1>
          <p className="doc-lede">
            When you push a fix, Clud Bug does not re-run a fresh review and bury
            you in new comments. It revisits each thread it already opened and
            asks one question of each: did this commit address the concern I
            raised? Then it resolves, keeps open, or escalates — and never
            silently dismisses a critical.
          </p>
        </header>

        <div className="doc-body">
          <h2>1. A fix-push reopens the conversation</h2>
          <p>
            On every fix-push — a <code>pull_request.synchronize</code> — the bot
            gathers the threads it posted on a prior pass that are still open. For
            each one it reconstructs the code at the finding&rsquo;s anchor{' '}
            <strong>before</strong> and <strong>after</strong> the new commit,
            plus the diff at that spot, and hands the trio to a per-thread
            verifier. Threads a human already resolved are left alone; only the
            bot&rsquo;s own open findings are revisited.
          </p>

          <h2>2. The per-thread verdict</h2>
          <p>
            The verifier is a single, narrow question — not a new review. It is
            told the prior finding, shown the before / after / diff, and asked
            whether the change resolved <em>that</em> concern. Its answer is
            exactly one of three verdicts:
          </p>
          <table className="doc-table">
            <thead>
              <tr>
                <th>Verdict</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>ADDRESSED</code>
                </td>
                <td>
                  The after-code unambiguously resolves the original concern. A
                  partial fix that leaves the core problem standing is not
                  ADDRESSED.
                </td>
              </tr>
              <tr>
                <td>
                  <code>NOT_ADDRESSED</code>
                </td>
                <td>
                  The problem still stands, the change is unrelated to the
                  concern, or it made things worse.
                </td>
              </tr>
              <tr>
                <td>
                  <code>UNCERTAIN</code>
                </td>
                <td>
                  The before / after alone cannot settle it. Never a guess — the
                  verifier says UNCERTAIN whenever it would be guessing.
                </td>
              </tr>
            </tbody>
          </table>
          <p>
            Two properties make this safe to trust. The verifier&rsquo;s system
            prompt is fixed in the module, never derived from the diff or the
            finding, so a hostile commit cannot rewrite the question it is being
            asked. And it treats the prior finding as a black box: it judges only
            whether the new code resolves what the finding said, not whether the
            finding was right in the first place. Both live in{' '}
            <a href={`${REPO_URL}/blob/main/src/core/resolve-verifier.ts`} rel="noopener">
              src/core/resolve-verifier.ts
            </a>
            .
          </p>
          <p>
            The verdict is <strong>fail-closed</strong>. The model is asked for a
            one-line JSON object; anything malformed — empty text, invalid JSON,
            an unknown verdict, a missing rationale — is parsed straight to{' '}
            <code>UNCERTAIN</code>, tagged as an API error. A model coerced into
            emitting the word ADDRESSED outside the required shape never lands as
            a pass. The only way to <code>ADDRESSED</code> is a well-formed model
            verdict that says so.
          </p>

          <h2>3. The rule table</h2>
          <p>
            The verdict, crossed with the finding&rsquo;s severity, decides the
            action. This is the whole table, pure and grounded in{' '}
            <a href={`${REPO_URL}/blob/main/src/core/auto-resolve.ts`} rel="noopener">
              src/core/auto-resolve.ts
            </a>
            :
          </p>
          <table className="doc-table">
            <thead>
              <tr>
                <th>Verdict</th>
                <th>Severity</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>ADDRESSED</code>
                </td>
                <td>any</td>
                <td>Resolve the thread; post &ldquo;Auto-resolved (verified)&rdquo;.</td>
              </tr>
              <tr>
                <td>
                  <code>NOT_ADDRESSED</code>
                </td>
                <td>🟡 minor</td>
                <td>Keep open; post &ldquo;Re-review found this still applies&rdquo;.</td>
              </tr>
              <tr>
                <td>
                  <code>NOT_ADDRESSED</code>
                </td>
                <td>🔴 critical</td>
                <td>Keep open and flag REQUEST_CHANGES.</td>
              </tr>
              <tr>
                <td>
                  <code>UNCERTAIN</code>
                </td>
                <td>🟡 minor</td>
                <td>Keep open; recommend a human look.</td>
              </tr>
              <tr>
                <td>
                  <code>UNCERTAIN</code>
                </td>
                <td>🔴 critical</td>
                <td>
                  Keep open, flag REQUEST_CHANGES, and escalate — never silently
                  dismiss.
                </td>
              </tr>
            </tbody>
          </table>
          <p>
            The last row is the load-bearing one. An uncertain verdict on a
            critical finding is the case where a careless tool would guess its way
            to green; here it is kept open and escalated. The{' '}
            <code>uncertain_critical_action</code> option in{' '}
            <a href="/docs/config">the manifest</a> can soften the escalation to a
            plain keep-open, but the thread is never resolved on uncertainty — the
            floor is human review, not a pass.
          </p>

          <h2>4. Resolving, honestly</h2>
          <p>
            Actually closing a review thread needs a token that can — the
            Actions&rsquo; default <code>GITHUB_TOKEN</code> cannot resolve
            threads. With a dedicated{' '}
            <code>CLUD_BUG_RESOLVE_PAT</code> present, a verified-addressed thread
            is auto-closed. Without one, the bot will not <em>claim</em> to have
            closed it: it posts &ldquo;Verified fixed — not auto-closed&rdquo; and
            leaves you the <strong>Resolve conversation</strong> button. The badge
            always matches what actually happened.
          </p>
          <p>
            Each reply carries a hidden marker recording the verdict and a
            signature of the post-fix anchor. A later fix-push that finds the
            anchor unmoved skips re-verifying and re-replying — one reply per
            distinct outcome, not one per push. So a noisy branch with many small
            commits does not accrete a stack of identical auto-resolve notes.
          </p>

          <h2>5. Turning it off</h2>
          <p>
            The whole behavior is one manifest block. <code>mode: &quot;off&quot;</code>{' '}
            leaves every prior thread open and makes no verifier calls at all;{' '}
            <code>mode: &quot;verified&quot;</code> (the default) runs the table
            above. See <a href="/docs/config">configuration</a> for the block and
            its defaults.
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
          <a href="/docs/config">config</a>
        </span>
      </footer>
    </main>
  );
}
