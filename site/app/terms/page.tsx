import type { Metadata } from 'next';

const ISSUES_URL = 'https://github.com/thrillmade/clud-bug-app/issues';

export const metadata: Metadata = {
  title: 'Terms of Service — Clud Bug',
  description: 'Terms of Service for the clud-bug GitHub App (draft, pending legal review).',
  alternates: { canonical: '/terms' },
  robots: { index: false, follow: true },
};

export default function Terms() {
  return (
    <main className="page">
      <header className="folio">
        <span>A Field Guide to Code Specimens</span>
        <span>Terms · MMXXVI</span>
      </header>

      <div className="doc">
        <a className="doc-back" href="/">← Field guide</a>

        <header className="doc-head">
          <span className="doc-eyebrow">§ Terms of Service</span>
          <h1 className="doc-title">Terms of Service.</h1>
          <p className="doc-lede">
            The agreement between you and clud-bug when you install and use the
            hosted GitHub App.
          </p>
        </header>

        <p className="doc-status">
          <strong>DRAFT — pending legal review.</strong> This is starter copy,
          not legal advice, and is not yet in force. Sections marked{' '}
          <code>[LEGAL REVIEW]</code> need counsel before this page is published
          as binding terms. Do not rely on it until this banner is removed.
        </p>

        <div className="doc-body">
          <h2>1. Acceptance</h2>
          <p>
            By installing or using the clud-bug GitHub App (the
            &ldquo;Service&rdquo;), you agree to these Terms. If you install on
            behalf of an organization, you represent that you are authorized to
            bind that organization.
          </p>

          <h2>2. The Service</h2>
          <p>
            clud-bug is an automated code-review App. It reads your pull
            requests, generates reviews using third-party AI (Anthropic), and
            posts the results back to your repository. The Service is provided
            on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. We
            may add, change, or remove features. Review output is advisory —
            you are responsible for the code you merge.
          </p>

          <h2>3. The open-source workflow is separate</h2>
          <p>
            clud-bug is also distributed as an open-source npm package and
            GitHub Action under the{' '}
            <a href="https://github.com/thrillmade/clud-bug/blob/main/LICENSE" rel="noopener">MIT
            License</a>. These Terms govern the <strong>hosted App only</strong>.
            Your use of the open-source workflow is governed by the MIT License,
            not this agreement.
          </p>

          <h2>4. Accounts &amp; billing</h2>
          <p>
            Paid tiers are billed through Stripe on a monthly basis. By
            selecting a paid plan you authorize recurring charges, including
            usage-based overage at the rate published on our{' '}
            <a href="/pricing">pricing page</a>. Plans are month-to-month and
            may be cancelled at any time; fees already incurred are
            non-refundable except where required by law.{' '}
            <code>[LEGAL REVIEW]</code> — refund, proration, and tax terms.
          </p>

          <h2>5. Acceptable use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Use the Service to violate any law or third-party right.</li>
            <li>Attempt to disrupt, overload, or reverse-engineer the hosted infrastructure (the source is open — audit it there instead).</li>
            <li>Resell or relabel the hosted Service without written permission.</li>
          </ul>

          <h2>6. Data</h2>
          <p>
            Our handling of your data is described in the{' '}
            <a href="/privacy">Privacy &amp; Data Handling policy</a>, which is
            incorporated into these Terms by reference.
          </p>

          <h2>7. Disclaimers</h2>
          <p>
            The Service relies on third-party AI and may produce incomplete,
            incorrect, or missed findings. We disclaim all warranties to the
            fullest extent permitted by law, including merchantability, fitness
            for a particular purpose, and non-infringement. clud-bug does not
            guarantee that the Service will catch any particular defect.
          </p>

          <h2>8. Limitation of liability</h2>
          <p>
            <code>[LEGAL REVIEW]</code> — To the fullest extent permitted by
            law, clud-bug&rsquo;s aggregate liability arising out of or relating
            to the Service will not exceed the amounts you paid in the twelve
            months preceding the claim. We are not liable for indirect,
            incidental, or consequential damages.
          </p>

          <h2>9. Termination</h2>
          <p>
            You may stop using the Service at any time by uninstalling the App
            (which triggers data deletion per the Privacy policy). We may
            suspend or terminate access for breach of these Terms or to comply
            with law.
          </p>

          <h2>10. Changes</h2>
          <p>
            We may update these Terms. Material changes will be reflected here
            with an updated date; continued use after a change constitutes
            acceptance.
          </p>

          <h2>11. Governing law</h2>
          <p>
            <code>[LEGAL REVIEW]</code> — Governing jurisdiction, dispute
            resolution, and the contracting entity to be specified by counsel.
          </p>

          <h2>12. Contact</h2>
          <p>
            Questions about these Terms:{' '}
            <a href={ISSUES_URL} rel="noopener">GitHub Issues</a>.
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
