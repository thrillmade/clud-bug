import type { Metadata } from 'next';

const APP_INSTALL_URL = 'https://github.com/apps/clud-bug/installations/new';
const APP_PRICING_URL = 'https://app.cludbug.dev/pricing';

export const metadata: Metadata = {
  title: 'Pricing — Clud Bug',
  description:
    'AI PR reviews. $9/mo + Anthropic cost + 20%. No surprises. Trial, Solo, and Team tiers — transparent cost-plus billing, the markup math you can audit.',
  alternates: { canonical: '/pricing' },
};

export default function Pricing() {
  return (
    <main className="page">
      <header className="folio">
        <span>A Field Guide to Code Specimens</span>
        <span>Pricing · MMXXVI</span>
      </header>

      <div className="doc">
        <a className="doc-back" href="/">← Field guide</a>

        <header className="doc-head">
          <span className="doc-eyebrow">§ Field Economy</span>
          <h1 className="doc-title">
            Honest <em>cost-plus</em>.
          </h1>
          <p className="doc-lede">
            AI PR reviews for <strong>$9/mo + what we pay Anthropic + 20%</strong>.
            No hidden seat margin, no surprise multipliers — we publish the
            Anthropic invoice each cycle so the markup math is yours to check.
          </p>
        </header>

        <div className="doc-body">
          <div className="tiers">
            <div className="tier">
              <span className="tier-name">Trial</span>
              <span className="tier-price">$0</span>
              <p className="tier-includes">
                First <strong>5 reviews</strong> on any repo, public or private.
                Enough to evaluate the bot on a real PR before you decide.
              </p>
            </div>
            <div className="tier feature">
              <span className="tier-name">Solo</span>
              <span className="tier-price">
                $9<small> /mo · per org</small>
              </span>
              <p className="tier-includes">
                <strong>25 private reviews</strong> a month. Below the
                unbudgeted-purchase line — a personal card, no procurement.
              </p>
            </div>
            <div className="tier">
              <span className="tier-name">Team</span>
              <span className="tier-price">
                $29<small> /seat · mo</small>
              </span>
              <p className="tier-includes">
                <strong>100 reviews per seat</strong>, pooled across the org.
                Unlocks the multi-pass cross-check &amp; the design critique.
              </p>
            </div>
          </div>

          <table className="doc-table">
            <thead>
              <tr>
                <th>Also</th>
                <th>Price</th>
                <th>Includes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Enterprise</strong></td>
                <td>Custom</td>
                <td>Unlimited reviews, SSO, a per-customer SLA. Billed direct.</td>
              </tr>
              <tr>
                <td><strong>Overage</strong><br />(Solo + Team)</td>
                <td>Anthropic cost&nbsp;×&nbsp;1.20</td>
                <td>
                  Past your tier&rsquo;s included reviews, usage bills at our
                  Anthropic cost plus a flat 20%. No tier jump, no throttling.
                </td>
              </tr>
            </tbody>
          </table>

          <p>
            Public repositories run under the same tier mechanics — there is no
            separate OSS-free track on the hosted App. (Prefer your own runner?
            The <a href="/#self-hosted">open-source workflow</a> is free; you
            bring the Anthropic key.)
          </p>

          <h2>Why cost-plus?</h2>
          <p>
            <strong>We charge a flat tier fee, then pass Anthropic&rsquo;s API
            cost through with a fixed 20% markup.</strong> Each billing cycle we
            publish the Anthropic invoice, so you can verify the math directly —
            no hidden seat margin, no surprise multipliers.
          </p>
          <p>
            <strong>Why not a flat $/review?</strong> Anthropic&rsquo;s
            per-review cost moves with diff size and which naturalist runs
            (Beetle on Sonnet, Wasp on Opus, Mantis only on disputes). A flat
            number either overcharges small PRs or undercharges large ones.
            Cost-plus is honest about that: your invoice is your invoice, not a
            pricing model&rsquo;s guess.
          </p>
          <p>
            <strong>Why a 5-review trial, not unlimited free?</strong> Five
            reviews cover one real PR and a few revisions — enough to judge the
            bot on your own code. Past that, the economics only work if the bot
            earns the upgrade.
          </p>

          <h2>Pick a plan</h2>
          <p>
            Plans are chosen at install time. <a href={APP_INSTALL_URL} rel="noopener">Install
            the GitHub App</a>, then manage your tier, usage, and billing on{' '}
            <a href={APP_PRICING_URL} rel="noopener">app.cludbug.dev</a>. Change
            tiers or cancel anytime — month to month, no contract.
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
          <a href="/privacy">privacy</a>
          {' · '}
          <a href="/terms">terms</a>
        </span>
      </footer>
    </main>
  );
}
