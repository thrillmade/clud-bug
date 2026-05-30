import { getLatestPublicReview } from '../lib/data';

export default async function Home() {
  // Server-fetched, cached for 1h. Returns null on any failure so the page
  // still renders; the observation section just hides itself in that case.
  const latest = await getLatestPublicReview();

  return (
    <main className="page">
      <header className="folio">
        <span>A Field Guide to Code Specimens</span>
        <span>Vol. 0 · No. 2 · MMXXVI</span>
      </header>

      {/* ─────────── FRONTISPIECE ─────────── */}
      <section className="hero">
        <aside className="plate appear">
          <span className="plate-number">№ I</span>
          <span className="plate-label">Plate I — Frontispiece</span>
          <span className="plate-gloss">
            <em>Plate</em>: a labeled illustration in a field guide.
            <em>Frontispiece</em>: the cover plate.
          </span>
          <span className="bug-pin" aria-hidden>🐛</span>
        </aside>
        <div>
          <h1 className="title appear-1">
            Clud <em>Bug</em>.
          </h1>
          <p className="subtitle appear-2">
            <strong>Skills-driven development</strong> at PR time.
            Skills you write. Reviews the bot does.
            <em className="binomial">— Cluddus bugfindii, observed crawling on every PR.</em>
          </p>
          <pre className="install-box appear-3">npx clud-bug init</pre>
          <div className="actions appear-4">
            <a href="https://github.com/thrillmade/clud-bug">View on GitHub</a>
            <span className="sep">·</span>
            <a href="#observations">Observations</a>
            <span className="sep">·</span>
            <a href="#how-to-collect">How to collect</a>
          </div>
        </div>
      </section>

      {/* ─────────── §I — WHY THIS EXISTS ─────────── */}
      <section className="section" id="observations">
        <header className="section-head">
          <span className="section-num">§ I — Habitat & Habit</span>
          <h2 className="section-title">Why a field guide.</h2>
        </header>
        <div className="section-body">
          <aside className="marginalia">
            Stock Claude PR review installs leave Claude unable to post comments. The
            bot thinks, then exits in silence. Specimens go uncatalogued.
          </aside>
          <div className="section-prose">
            <p>
              The official <code>anthropics/claude-code-action</code> ships with{' '}
              <code>gh pr comment</code> disabled by default. Without an explicit{' '}
              <code>--allowedTools</code> whitelist, Claude runs through your diff,
              composes a thorough review, and exits without ever posting a word.
            </p>
            <p>
              <strong>Clud Bug</strong> ships the correct workflow configuration <em>and</em>{' '}
              auto-curates skills from your repository — Next.js review patterns for a
              Next.js repo, FastAPI patterns for a FastAPI repo, your team&rsquo;s own rules
              for your team&rsquo;s own repo. Every PR gets a comment within ~2 minutes,
              shaped by skills relevant to what you actually wrote.
            </p>
            <p>
              <a href="https://zakelfassi.com/skdd-skills-driven-development"><strong>Skills-driven
              development</strong></a> (SkDD): test-driven development for AI. You
              write skills first — your team&rsquo;s conventions, brand voice,
              API-contract rules, compliance constraints — and every PR review is
              graded against them. Generic best-practice advice that contradicts a
              project skill is wrong by definition. Skills carry authority.
            </p>
          </div>
        </div>
      </section>

      {/* ─────────── §II — SKILLS ─────────── */}
      <section className="section">
        <header className="section-head">
          <span className="section-num">§ II — Specimens for your habitat</span>
          <h2 className="section-title">Skills are how Clud Bug knows your codebase.</h2>
        </header>
        <div className="section-body">
          <aside className="marginalia">
            Drop a Markdown file into <code>.claude/skills/</code> and Clud Bug
            cites it by name on every review. Your team&rsquo;s standards
            become the reviewer.
          </aside>
          <div>
            <p className="section-prose-lead">
              Generic PR review tools evaluate your code against generic best
              practices. Clud Bug evaluates it against <em>your</em> standards
              &mdash; encoded as plain Markdown the bot loads on every PR. A
              few of the high-value patterns teams write:
            </p>
            <div className="specimens">
              <article className="specimen">
                <span className="specimen-tag">Spec. brand-voice</span>
                <h3 className="specimen-name">Brand voice review</h3>
                <p className="specimen-desc">
                  &ldquo;Microcopy reviewed against the brand guide. Button
                  labels follow verb-noun. Toasts ≤ 80 chars. No exclamation
                  marks outside the success state.&rdquo;
                </p>
                <span className="specimen-pin">cat. № YOU-001</span>
              </article>
              <article className="specimen">
                <span className="specimen-tag">Spec. api-contract</span>
                <h3 className="specimen-name">API contract enforcement</h3>
                <p className="specimen-desc">
                  &ldquo;Anything under <code>/v1/*</code> is frozen. Schema
                  changes need a <code>/v2</code> alongside. Flag breaking
                  changes; require deprecation headers on removals.&rdquo;
                </p>
                <span className="specimen-pin">cat. № YOU-002</span>
              </article>
              <article className="specimen">
                <span className="specimen-tag">Spec. compliance</span>
                <h3 className="specimen-name">Compliance &amp; PII</h3>
                <p className="specimen-desc">
                  &ldquo;No PII (email, phone, name) in logs, ever. No{' '}
                  <code>console.log</code> in <code>app/api/*</code>. Every
                  secret read needs an audit log entry.&rdquo;
                </p>
                <span className="specimen-pin">cat. № YOU-003</span>
              </article>
              <article className="specimen">
                <span className="specimen-tag">Spec. test-discipline</span>
                <h3 className="specimen-name">Test discipline</h3>
                <p className="specimen-desc">
                  &ldquo;Every new endpoint ships a happy-path and a 4xx test
                  in the same PR. Refactors can&rsquo;t reduce test count
                  without an explicit note.&rdquo;
                </p>
                <span className="specimen-pin">cat. № YOU-004</span>
              </article>
            </div>
            <p className="specimens-footer">
              Plus four baseline skills always pinned&nbsp;—{' '}
              <code>critical-issues-only</code>,{' '}
              <code>evidence-based-review</code>,{' '}
              <code>respect-existing-conventions</code>,{' '}
              <code>clud-bug-collaboration</code>. Browse community-contributed
              skills at <a href="https://skills.sh">skills.sh</a>.
            </p>
          </div>
        </div>
      </section>

      {/* ─────────── §III — FIELD OBSERVATION ─────────── */}
      <section className="section">
        <header className="section-head">
          <span className="section-num">§ III — Recorded Observation</span>
          <h2 className="section-title">From Clud Bug&rsquo;s notebook.</h2>
        </header>
        <div className="section-body">
          <aside className="marginalia">
            A single PR review on a fixture file with four planted defects. The naturalist
            also flagged a fifth issue the author had not intended.
          </aside>
          {latest ? (
            <blockquote className="observation">
              {latest.headline}
              <footer>
                Latest field note ·{' '}
                <a href={latest.prUrl} style={{ color: 'inherit' }}>
                  PR #{latest.prNumber}: {latest.prTitle}
                </a>
              </footer>
            </blockquote>
          ) : (
            <blockquote className="observation">
              Found all four planted bugs plus a fifth bonus problem (command injection via
              <code style={{ background: 'transparent', border: 0, padding: 0, fontStyle: 'normal' }}> sh -c + rm -rf</code>{' '}
              — worse than the SQL injection — RCE). Inline comments posted at each site.
              <footer>Specimen review · 53 seconds · PR #2</footer>
            </blockquote>
          )}
        </div>
      </section>

      {/* ─────────── §IV — REVIEW BUDGET ─────────── */}
      <section className="section">
        <header className="section-head">
          <span className="section-num">§ IV — Field Economy</span>
          <h2 className="section-title">Even the largest specimens get a full examination.</h2>
        </header>
        <div className="section-body">
          <aside className="marginalia">
            The naturalist sizes up the specimen before reaching for the
            magnifying glass. Tiny moth, brief examination. Large beetle, longer
            study. Either way: no half-finished field notes.
          </aside>
          <div className="section-prose">
            <p>
              Every PR review gets a budget tailored to its diff. Clud Bug looks
              at the changed lines first &mdash; a one-file typo gets a quick
              pass; a thousand-line refactor gets the time it needs. The bot is
              told its own budget upfront and checks in with itself mid-review,
              so the summary at the bottom of your PR is always a finished
              thought, never a half-written sentence.
            </p>
            <p>
              <strong>Why this matters.</strong> Stock PR-review tools pick a
              fixed turn count and hope. On small PRs they overspend; on large
              PRs they run out and leave you with an incomplete review. The
              budget-aware approach: tiny PR gets ~5 turns of attention, large
              PR gets ~25, very large gets ~40 &mdash; same Clud Bug, same
              quality bar.
            </p>
          </div>
        </div>
      </section>

      {/* ─────────── §V — DROP-IN PROPAGATION ─────────── */}
      <section className="section">
        <header className="section-head">
          <span className="section-num">§ V — Habitat Expansion</span>
          <h2 className="section-title">One PR per repo. Then quiet self-updates.</h2>
        </header>
        <div className="section-body">
          <aside className="marginalia">
            Adding a specimen to a new habitat takes the same act of collection
            every time. After that, the colony tends itself.
          </aside>
          <div className="section-prose">
            <p>
              Rolling Clud Bug across an org used to take an admin override on
              every workflow file as it landed. Now: one PR per repo, then
              quiet. Subsequent updates to skills, prompts, or the workflow
              itself ship through clean PRs that the bot auto-classifies and
              skips when there&rsquo;s nothing for a reviewer to read.
            </p>
            <p>
              <strong>Code changes still get reviewed.</strong> The auto-skip
              fires only on workflow-only PRs &mdash; any commit that touches a
              source file outside the allowlist still gets the full Clud Bug
              treatment. Skill files, configs, and decision logs may ride
              along, but the moment something in <code>src/</code> changes,
              the naturalist is on the scene.
            </p>
          </div>
        </div>
      </section>

      {/* ─────────── §VI — INSTALL ─────────── */}
      <section className="section" id="how-to-collect">
        <header className="section-head">
          <span className="section-num">§ VI — Field Procedure</span>
          <h2 className="section-title">How to begin collecting.</h2>
        </header>
        <div className="section-body">
          <aside className="marginalia">
            Set <code>ANTHROPIC_API_KEY</code> in your repository&rsquo;s Actions secrets
            (<em>Settings → Secrets and variables → Actions</em>). Open a PR. The
            naturalist arrives within two minutes.
          </aside>
          <div>
            <pre className="terminal">
              <span className="cmd">npx clud-bug init</span>{'\n'}
              <span className="out">  🐛 Field season opens here.</span>{'\n'}
              <span className="out">    baseline kit: <span className="num">4</span> specimens</span>{'\n'}
              <span className="out">  pinned <span className="num">4</span> to <span className="path">.claude/skills/</span></span>{'\n'}
              <span className="out">  wrote <span className="path">.github/workflows/clud-bug-review.yml</span></span>{'\n\n'}
              <span className="cmd">git add <span className="path">.claude .github/workflows/</span></span>{'\n'}
              <span className="cmd">git commit -m &quot;Add clud-bug&quot; && git push</span>{'\n'}
            </pre>
          </div>
        </div>
      </section>

      <footer className="colophon">
        <span>
          Open source. <a href="https://github.com/thrillmade/clud-bug/blob/main/LICENSE">MIT</a>. v0.6.27.
        </span>
        <span className="credit">
          a <a href="https://thrillmot.com" rel="noopener">thrillmot</a> project
        </span>
        <span>
          <a href="https://github.com/thrillmade/clud-bug">github.com/thrillmade/clud-bug</a>
        </span>
      </footer>
    </main>
  );
}
