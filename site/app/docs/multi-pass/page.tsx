import type { Metadata } from 'next';

const REPO_URL = 'https://github.com/thrillmade/clud-bug';

export const metadata: Metadata = {
  title: 'Multi-pass review — Clud Bug docs',
  description:
    'The three naturalists of a multi-pass review — Beetle, Wasp, Mantis — the cross-check, consensus, and independent modes, and why a reproduction you ran grounds a finding as firmly as a quoted line.',
  alternates: { canonical: '/docs/multi-pass' },
};

export default function DocsMultiPass() {
  return (
    <main className="page">
      <header className="folio">
        <span>A Field Guide to Code Specimens</span>
        <span>Multi-pass · MMXXVI</span>
      </header>

      <div className="doc">
        <a className="doc-back" href="/docs">← Field manual</a>

        <header className="doc-head">
          <span className="doc-eyebrow">§ Multi-pass Review</span>
          <h1 className="doc-title">Three naturalists.</h1>
          <p className="doc-lede">
            A single reviewer optimizing for recall will over-report. A single
            reviewer optimizing for precision will miss the subtle ones. A
            multi-pass review splits the work: one pass casts a wide net, a second
            tries to tear the catch apart, and a third settles what they cannot
            agree on.
          </p>
        </header>

        <div className="doc-body">
          <h2>1. Beetle, Wasp, Mantis</h2>
          <p>
            Three roles, in a fixed order. Each is a distinct reviewer with its
            own tier — a fast model for the broad scan, a stronger model for the
            adversarial work.
          </p>
          <table className="doc-table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Tier</th>
                <th>Its job</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>Beetle</strong>
                </td>
                <td>Sonnet-class</td>
                <td>
                  The broad first scan. Reads the diff against every skill and
                  optimizes for recall — surface every candidate.
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Wasp</strong>
                </td>
                <td>Opus-class</td>
                <td>
                  The adversary. Re-reads the diff and tries to <em>refute</em>{' '}
                  Beetle&rsquo;s findings — prove each a false positive, or add the
                  real ones Beetle missed. Only findings that survive refutation
                  are kept.
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Mantis</strong>
                </td>
                <td>Opus-class</td>
                <td>
                  The arbiter. Dispatched only when two passes disagree on a
                  gate-relevant finding; re-examines the disputed ones and records
                  the deciding verdict.
                </td>
              </tr>
            </tbody>
          </table>
          <p>
            Skepticism is the point of the second pass — Wasp&rsquo;s job is to
            disagree, not to nod. The defaults live in{' '}
            <a href={`${REPO_URL}/blob/main/src/core/review-plan.ts`} rel="noopener">
              src/core/review-plan.ts
            </a>
            . Multi-pass is App-tier: the hosted bot orchestrates the three roles
            server-side. The open-source workflow runs the same skill engine and
            the same grounding discipline described below.
          </p>

          <h2>2. Three modes of aggregation</h2>
          <p>
            How the passes combine is a choice, set by{' '}
            <code>reviewPasses.mode</code> in{' '}
            <a href="/docs/config">the manifest</a>. Each trades recall against
            precision differently.
          </p>
          <table className="doc-table">
            <thead>
              <tr>
                <th>Mode</th>
                <th>How findings combine</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>cross-check</code>
                </td>
                <td>
                  The default. Pass 1 scans broadly; each later pass is
                  adversarial and tries to refute it. Keep only what survives
                  refutation.
                </td>
              </tr>
              <tr>
                <td>
                  <code>consensus</code>
                </td>
                <td>
                  Passes run independently; keep a finding only when two or more
                  land on it — except a critical, which is never silently dropped:
                  reproduce it to keep, or refute it with a clean check.
                </td>
              </tr>
              <tr>
                <td>
                  <code>independent</code>
                </td>
                <td>
                  Passes run independently and their findings are unioned, each
                  attributed to its pass — minus any a quick adversarial re-read
                  refutes.
                </td>
              </tr>
            </tbody>
          </table>
          <p>
            Passes are capped at three. A two-pass cross-check escalates to a
            third Mantis pass <em>only</em> when passes 1 and 2 disagree on a
            critical or minor finding — if they agree, or only differ on a
            pre-existing note, the arbiter is skipped. The prose the reviewer
            actually follows is assembled in{' '}
            <a href={`${REPO_URL}/blob/main/src/cli/review-prompt.ts`} rel="noopener">
              src/cli/review-prompt.ts
            </a>
            .
          </p>

          <h2>3. Reproduction as grounding</h2>
          <p>
            The oldest rule against false positives is &ldquo;quote the exact line
            or drop it&rdquo;. It is a good floor and a bad ceiling: an emergent,
            combinatorial, or cross-cutting bug lives on no single changed line, so
            the rule that kills noise also silences real bugs. Clud Bug widens the
            gate. A finding must be grounded in <strong>any one</strong> of:
          </p>
          <ul>
            <li>
              <strong>a quoted line</strong> — the exact offending line from the
              diff, with its line number;
            </li>
            <li>
              <strong>a reproduction you ran</strong> — the command plus the
              observed output that demonstrates the bug. A repro is{' '}
              <em>stronger</em> evidence than a quote, not weaker;
            </li>
            <li>
              <strong>a named violated invariant</strong> — a one-sentence
              property the change breaks, plus the input that breaks it.
            </li>
          </ul>
          <p>
            A finding that none of these can ground is dropped; silence beats a
            false positive. But a bug that lives between correct lines is not
            waved through on suspicion — it is reproduced or named. A reproduction
            or a named invariant satisfies even a skill whose letter says
            &ldquo;quote the line&rdquo;: the wider grounding wins. This is the{' '}
            <code>GROUNDING_RULE</code>, and it is paired with an execution-safety
            boundary — a reproduction runs only against your own trusted work,
            never against an untrusted contributor&rsquo;s diff, since running that
            would be code execution with the reviewer&rsquo;s shell and tokens.
          </p>

          <h2>4. What the benchmark found</h2>
          <p>
            The grounding rule was measured against a seeded corpus of{' '}
            <strong>20 scenarios</strong> — 14 planted bugs across the emergent,
            combinatorial, and cross-cutting classes, plus 6 clean decoys: correct
            code wearing a bug-prone shape. Each was scored by three independent
            reviewers.
          </p>
          <table className="doc-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Recall — buggy scenarios caught</td>
                <td>100% (every planted bug, all reviewers)</td>
              </tr>
              <tr>
                <td>Precision — clean scenarios not flagged</td>
                <td>100% (zero false positives)</td>
              </tr>
              <tr>
                <td>Grounding</td>
                <td>Every catch grounded by a reproduction the reviewer ran</td>
              </tr>
            </tbody>
          </table>
          <p>
            The decoys are the interesting half. Reviewers reproduced the tricky
            input, confirmed the invariant <em>held</em>, and reported nothing —
            the same discipline that catches the emergent bug keeps the reviewer
            quiet on code that merely looks dangerous. The full corpus and per-bug
            notes are in{' '}
            <a href={`${REPO_URL}/blob/main/benchmark/RESULTS.md`} rel="noopener">
              benchmark/RESULTS.md
            </a>
            .
          </p>
          <p>
            Executable invariants are how you carry this discipline into your own
            repo — a probe that runs RED is a reproduction the review does not have
            to improvise. See <a href="/docs/config">the invariants block</a> for
            how to declare one.
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
