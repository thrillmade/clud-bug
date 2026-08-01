import { getLatestPublicReview } from '../lib/data';

const APP_INSTALL_URL = 'https://github.com/apps/clud-bug/installations/new';
// Bare-domain URL for visible "app.cludbug.dev" link text — the root
// redirects authenticated users to /dashboard and unauthenticated users
// to /sign-in. Keeping href and visible text in agreement avoids the
// "click bare domain → land on subpath" confusion the PR #165 reviewer
// flagged (CTO follow-up 2026-06-17).
const APP_ROOT_URL = 'https://app.cludbug.dev';
// Specific routes get specific URLs (used where the visible text is the
// route name, e.g. "dashboard").
const APP_DASHBOARD_URL = 'https://app.cludbug.dev/dashboard';
// Pricing lives on the marketing site itself (cludbug.dev/pricing) — the canonical
// URL the GitHub Marketplace listing requires. (Previously app.cludbug.dev/pricing.)
const SITE_PRICING_URL = '/pricing';
const APP_COMPARE_URL = 'https://app.cludbug.dev/compare';

export default async function Home() {
  // Server-fetched, cached for 1h. Returns null on any failure so the page
  // still renders; the observation section just hides itself in that case.
  const latest = await getLatestPublicReview();

  return (
    <main className="page">
      <header className="folio">
        <span>A Field Guide to Code Specimens</span>
        <span>Vol. I · No. 1 · MMXXVI</span>
      </header>

      {/* ─────────── FRONTISPIECE ─────────── */}
      <section className="hero">
        <aside className="plate appear">
          <span className="plate-number">№ I</span>
          <span className="plate-label">Plate I — Frontispiece</span>
          <span className="bug-pin" aria-hidden>🐛</span>
        </aside>
        <div>
          <h1 className="title appear-1">
            Clud <em>Bug</em>.
          </h1>
          <p className="subtitle appear-2">
            <strong>AI PR review with project-aware skills.</strong>
            {' '}Install the GitHub App, write a skill, get reviews graded
            against <em>your</em> conventions on every pull request.
            <em className="binomial">— Cluddus bugfindii, observed crawling on every PR.</em>
          </p>
          <div className="cta-stack appear-3">
            <a
              className="cta-primary"
              href={APP_INSTALL_URL}
              rel="noopener"
            >
              <span className="cta-glyph" aria-hidden>→</span>
              Install the GitHub App
            </a>
            <p className="cta-fineprint">
              Managed tiers — see{' '}
              <a href={SITE_PRICING_URL} rel="noopener">pricing</a> and{' '}
              <a href={APP_COMPARE_URL} rel="noopener">compare</a> on{' '}
              <a href={APP_ROOT_URL} rel="noopener">app.cludbug.dev</a>, or{' '}
              <a href="#self-hosted">self-host the open-source workflow</a> for free.
            </p>
            <p className="cta-fineprint cta-secondary">
              <a href="#self-hosted">Self-hosted? Use the open-source workflow →</a>
            </p>
          </div>
          <div className="actions appear-4">
            <a href="#how-it-works">How it works</a>
            <span className="sep">·</span>
            <a href="#observations">Field notes</a>
            <span className="sep">·</span>
            <a href="https://github.com/thrillmade/clud-bug" rel="noopener">GitHub</a>
          </div>
        </div>
      </section>

      {/* ─────────── §I — HOW IT WORKS ─────────── */}
      <section className="section" id="how-it-works">
        <header className="section-head">
          <span className="section-num">§ I — Field Procedure</span>
          <h2 className="section-title">Three steps. Two minutes per review.</h2>
        </header>
        <div className="section-body">
          <aside className="marginalia">
            No workflow file. No <code>ANTHROPIC_API_KEY</code> rotation. The
            App carries its own credentials and posts inline comments under
            its own GitHub identity.
          </aside>
          <ol className="howto">
            <li className="howto-step">
              <span className="howto-num">1</span>
              <h3 className="howto-name">Install</h3>
              <p className="howto-desc">
                <a href={APP_INSTALL_URL} rel="noopener">Install the GitHub
                App</a> on the org or repos you want reviewed. Approve the
                permissions for pull requests, contents, and checks.
              </p>
            </li>
            <li className="howto-step">
              <span className="howto-num">2</span>
              <h3 className="howto-name">Authorize</h3>
              <p className="howto-desc">
                Pick a plan on the{' '}
                <a href={APP_DASHBOARD_URL} rel="noopener">dashboard</a>{' '}
                — managed tiers for any repo, public or private. The bot
                reviews against the skills in <code>.claude/skills/</code>,
                starting with the baseline kit.
              </p>
            </li>
            <li className="howto-step">
              <span className="howto-num">3</span>
              <h3 className="howto-name">Reviews land</h3>
              <p className="howto-desc">
                Every PR (and every push to one) gets an inline review within
                ~2 minutes — comments cited by skill name, anchored at the
                exact line.
              </p>
            </li>
          </ol>
        </div>
      </section>

      {/* ─────────── §II — SKILLS ─────────── */}
      <section className="section" id="skills">
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

      {/* ─────────── §III — MULTI-PASS (BEETLE / WASP / MANTIS) ─────────── */}
      <section className="section" id="multi-pass">
        <header className="section-head">
          <span className="section-num">§ III — Three Naturalists</span>
          <h2 className="section-title">When one pair of eyes isn&rsquo;t enough.</h2>
        </header>
        <div className="section-body">
          <aside className="marginalia">
            Available on the Team tier. Each pass writes to the same PR but
            signs its own comments. Disagreements get adjudicated, not
            averaged. <a href={SITE_PRICING_URL} rel="noopener">Pricing →</a>
          </aside>
          <div className="section-prose">
            <p>
              Most reviews are a single fast pass — skill-aware and cited. On
              the Team tier, Clud Bug runs a two-pass cross-check: a second
              naturalist re-reads the first one&rsquo;s findings against the
              diff, and a third — the arbiter — is called in only when the two
              disagree:
            </p>
            <div className="passes">
              <article className="pass">
                <span className="pass-tag">Pass 1</span>
                <h3 className="pass-name">Beetle</h3>
                <p className="pass-desc">
                  The broad scan. Walks the full diff, surfaces every
                  candidate issue, no filtering. Optimized for recall.
                </p>
              </article>
              <article className="pass">
                <span className="pass-tag">Pass 2</span>
                <h3 className="pass-name">Wasp</h3>
                <p className="pass-desc">
                  The cross-check. Re-reads Beetle&rsquo;s findings against
                  the diff and the skills, drops noise, escalates the real
                  ones, and catches what Beetle missed.
                </p>
              </article>
              <article className="pass">
                <span className="pass-tag">Pass 3</span>
                <h3 className="pass-name">Mantis</h3>
                <p className="pass-desc">
                  The arbiter. Only fires on disputes — where Beetle and
                  Wasp disagree on severity or correctness. Returns a single
                  decisive call with reasoning.
                </p>
              </article>
            </div>
            <p>
              Three perspectives, one PR thread, citations all the way down.{' '}
              <a href={APP_COMPARE_URL} rel="noopener">Compare tiers →</a>
            </p>
          </div>
        </div>
      </section>

      {/* ─────────── §IV — HARDENED REVIEW (reproduction-grounded) ─────────── */}
      <section className="section" id="hardened">
        <header className="section-head">
          <span className="section-num">§ IV — Weight of Evidence</span>
          <h2 className="section-title">A finding carries the evidence that caught it.</h2>
        </header>
        <div className="section-body">
          <aside className="marginalia">
            The reviewer executes nothing of its own &mdash; no probe, no build,
            no test run against the diff. A reproduction is a CI check the
            repository&rsquo;s own forge already ran, read rather than run.
          </aside>
          <div className="section-prose">
            <p>
              Most review tools can only point at one suspicious line, so those
              are the only bugs they catch. Clud Bug grounds every finding one
              of three ways &mdash; a line quoted from the diff, a reproduction
              &mdash; a CI check that already ran and failed, read rather than
              run &mdash; or a named invariant the change breaks. The
              reproduction is the sharp end: a real bug often lives on{' '}
              <em>no</em> single changed line.
            </p>
            <p>
              That reaches three classes a line-scanner walks past.{' '}
              <strong>Emergent</strong> &mdash; bad data flowing through
              individually-correct lines, like a shared default mutated across
              calls. <strong>Combinatorial</strong> &mdash; an invariant broken
              only by a constructed input, like a duplicate key on a collision.{' '}
              <strong>Cross-cutting</strong> &mdash; a cause in another file the
              diff merely exposes, like a date-only sort read from a module the
              change never touched.
            </p>
            <p>
              <strong>The measurement.</strong> On a seeded corpus of 20
              scenarios &mdash; 14 planted defects across those three classes plus
              6 clean look-alikes as precision controls, each scored by three
              independent reviewers &mdash; the hardened recipe caught every bug
              and false-flagged none: 100% recall, 100% precision, every catch
              grounded by a reproduction the reviewer wrote and ran &mdash;
              measured under the execution-grounded Phase R recipe, since
              superseded by the CI-evidence model above; a fresh run against
              the new recipe is pending.
            </p>
          </div>
        </div>
      </section>

      {/* ─────────── §V — FIELD OBSERVATION ─────────── */}
      <section className="section" id="observations">
        <header className="section-head">
          <span className="section-num">§ V — Recorded Observation</span>
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

      {/* ─────────── §VI — REVIEW BUDGET ─────────── */}
      <section className="section">
        <header className="section-head">
          <span className="section-num">§ VI — Field Economy</span>
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

      {/* ─────────── §VII — AUTO-FIX & AUTO-RESOLVE ─────────── */}
      <section className="section" id="auto-resolve">
        <header className="section-head">
          <span className="section-num">§ VII — Return Visit</span>
          <h2 className="section-title">Push a fix; the reviewer comes back to check it.</h2>
        </header>
        <div className="section-body">
          <aside className="marginalia">
            Only the threads Clud Bug opened are revisited &mdash; the rest of the
            conversation is left untouched. A thread it resolves is marked
            verified, so the audit trail stays honest.
          </aside>
          <div className="section-prose">
            <p>
              Every finding lands with a one-line fix. Push the change, and on
              the next commit Clud Bug re-reads each thread it opened &mdash;
              comparing the code at the anchor before and after &mdash; and
              decides, thread by thread, whether the concern was actually
              addressed.
            </p>
            <p>
              A thread that was <strong>addressed</strong> resolves itself and
              says so. One that was <strong>not</strong> stays open, noted that
              the re-review still applies &mdash; and if it was critical, the check
              flips to request-changes. When the verdict is{' '}
              <strong>uncertain</strong> on a critical finding, the thread stays
              open and escalates: a critical is never silently dismissed. What
              was genuinely fixed clears out; what still matters stays pinned.
            </p>
          </div>
        </div>
      </section>

      {/* ─────────── §VIII — DESIGN-CRITIC (optional visual review) ─────────── */}
      <section className="section" id="design-critic">
        <header className="section-head">
          <span className="section-num">§ VIII — A Second Lens</span>
          <h2 className="section-title">For UI changes, an eye on the rendered page.</h2>
        </header>
        <div className="section-body">
          <aside className="marginalia">
            Off by default, Team tier. Turned on per repo, and advisory unless
            the gate is set to strict &mdash; then a critical design finding turns
            the check red like any other.
          </aside>
          <div className="section-prose">
            <p>
              Code review reads the diff; it never sees the page. When a repo
              carries design skills &mdash; a house style, a spacing scale, a set
              of elite-UI standards &mdash; Clud Bug can open an optional visual
              pass. On a pull request with a live preview, it renders each
              changed surface in light and dark, then critiques the screenshots
              against those skills, citing the element it sees and the standard
              it reads against.
            </p>
            <p>
              It flags what is <em>fine but not elite</em>, not only what is
              broken. The pass stays off until a repo asks for it, and stays
              advisory until it is told to gate &mdash; the render runs only on an
              opted-in Team repo, only on a pull request, only when a design
              skill is installed.
            </p>
          </div>
        </div>
      </section>

      {/* ─────────── §IX — MAX MODE (free local tier) ─────────── */}
      <section className="section" id="max-mode">
        <header className="section-head">
          <span className="section-num">§ IX — Max Mode</span>
          <h2 className="section-title">The review runs in the session you already pay for.</h2>
        </header>
        <div className="section-body">
          <aside className="marginalia">
            No API key, no hosted bill. Max mode reviews on your own Claude Code
            subscription &mdash; the free tier, and the most local path of all.
          </aside>
          <div>
            <p className="section-prose-lead">
              The hosted App carries its own credentials and its own runner. Max
              mode carries neither: the review runs <em>inside</em> the Claude
              Code session already open on your machine, on the subscription you
              already have. A commit hook surfaces the review recipe;{' '}
              <code>/clud-bug-review</code> runs it on demand against the current
              branch&rsquo;s open PR.
            </p>
            <pre className="terminal">
              <span className="cmd">npx clud-bug init --with-hooks</span>{'\n'}
              <span className="out">  🐛 commit hook wired into <span className="path">.claude/settings.json</span></span>{'\n'}
              <span className="out">  reviews run on this session &mdash; no <span className="path">ANTHROPIC_API_KEY</span></span>{'\n\n'}
              <span className="cmd">git commit -m &quot;Fix the parser&quot;</span>{'\n'}
              <span className="out">  clud-bug review (max mode) &mdash; on your subscription</span>{'\n'}
            </pre>
            <p className="specimens-footer">
              Same skill engine, same grounding. The recipe is rendered from the
              shared review engine, so a commit gets a single fast pass and a
              pull request gets the deeper review the diff calls for. The commit
              is never blocked; the review lands back in the session as a note
              you can act on.
            </p>
          </div>
        </div>
      </section>

      {/* ─────────── §X — SELF-HOSTED ALTERNATIVE ─────────── */}
      <section className="section" id="self-hosted">
        <header className="section-head">
          <span className="section-num">§ X — Self-hosted alternative</span>
          <h2 className="section-title">Prefer your own runner? Ship the workflow.</h2>
        </header>
        <div className="section-body">
          <aside className="marginalia">
            Set <code>ANTHROPIC_API_KEY</code> in your repository&rsquo;s Actions secrets
            (<em>Settings → Secrets and variables → Actions</em>). Open a PR. The
            naturalist arrives within two minutes.
          </aside>
          <div>
            <p className="section-prose-lead">
              The hosted GitHub App is the recommended path — managed runner,
              managed billing, no secrets to rotate. For air-gapped orgs and
              teams that want to bring their own Anthropic key, the same
              review engine ships as an open-source npm package and runs as a
              GitHub Action under your own credentials.
            </p>
            <pre className="terminal">
              <span className="cmd">npx clud-bug init</span>{'\n'}
              <span className="out">  🐛 Field season opens here.</span>{'\n'}
              <span className="out">    baseline kit: <span className="num">4</span> specimens</span>{'\n'}
              <span className="out">  pinned <span className="num">4</span> to <span className="path">.claude/skills/</span></span>{'\n'}
              <span className="out">  wrote <span className="path">.github/workflows/clud-bug-review.yml</span></span>{'\n\n'}
              <span className="cmd">git add <span className="path">.claude .github/workflows/</span></span>{'\n'}
              <span className="cmd">git commit -m &quot;Add clud-bug&quot; && git push</span>{'\n'}
            </pre>
            <p className="specimens-footer">
              Same skill engine, same review quality. You manage the
              runner and the API key. Multi-pass (Beetle / Wasp / Mantis)
              is App-tier only — the hosted bot orchestrates the three
              roles server-side.{' '}
              <a href="https://github.com/thrillmade/clud-bug#readme" rel="noopener">
                Read the workflow docs →
              </a>
            </p>
          </div>
        </div>
      </section>

      <footer className="colophon">
        <span>
          Open source. <a href="https://github.com/thrillmade/clud-bug/blob/main/LICENSE">MIT</a>.
        </span>
        <span className="credit">
          a <a href="https://thrillmot.com" rel="noopener">thrillmot</a> project
        </span>
        <span>
          <a href={APP_DASHBOARD_URL} rel="noopener">app.cludbug.dev</a>
          {' · '}
          <a href="https://github.com/thrillmade/clud-bug">github</a>
        </span>
      </footer>
    </main>
  );
}
