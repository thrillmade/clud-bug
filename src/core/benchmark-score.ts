// src/core/benchmark-score.ts — scorer for the planted-defect benchmark
// (#270, SPEC 2.0 §8.2: "A reviewer MUST periodically be given a change
// carrying a defect whose presence is known in advance, and MUST report it").
//
// Pure function. Input = one entry per (scenario, reviewer) plus the committed
// answer keys; output = per-scenario verdicts and the totals the published
// wording is rendered from. No I/O, no clock, no reviewer call — the runner
// (`scripts/run-benchmark.mjs`) owns all of that, so the numbers can be
// re-derived from a stored run without a key.
//
// The scoring rules, which the code alone cannot justify:
//
//   - Only `critical_findings` count, for a catch and for a false flag alike.
//     The benchmark measures what the merge gate would do, and only a 🔴
//     blocks. A planted defect noted as a 🟡 ships; a decoy noted as a 🟡 does
//     not block anyone.
//   - A catch must be LOCATED at the planted site. A review that flags the
//     right scenario for the wrong reason is not evidence the reviewer is
//     working — §8.2's test is that it reports *the* defect.
//   - A finding this scorer cannot place — no `file` (the schema permits that
//     for a cross-cutting finding), or a `line` that is not a line number —
//     is read for the site instead of discarded: it is a catch if its OWN TEXT
//     (`summary`, `reasoning` or `grounding`) names the planted site's file,
//     and a `missed` otherwise. A reviewer that wrote the file's name into its
//     reasoning reported the defect; one that named nothing anywhere did not,
//     and calling that `unverified` published a scenario as unscored when it
//     had been scored and answered. The `file` field itself is never read as
//     text — a finding that named the file and a line this cannot compare has
//     already had its site rejected, and reading the name back out would make
//     a malformed line into a file-level match.
//   - On a clean decoy, a 🔴 anywhere in the scenario is a false positive: the
//     whole scenario is correct code, so there is no site where a blocking
//     finding is right — and an unplaceable 🔴 blocks the merge just as a
//     placed one does, so nothing about its location is in question there.
//   - Several reviewers on one scenario resolve conservatively: every reviewer
//     must catch it, and one flagging a decoy is a false positive. A defect
//     caught one run in three is a reviewer you cannot trust on the run you
//     did not check.
//   - A scenario with no review at all is `unverified` and leaves BOTH terms
//     of its ratio — SPEC §4.9: "A review cut short for cost is unverified,
//     never clean". That is the only route to `unverified`: a review that
//     happened is scored. The remainder is then
//     named rather than dropped, which is §2.8's truncation rule ("whenever a
//     tool elides content, it MUST leave a marker at the cut") applied to
//     verification — the move §8.2 makes for a partial re-review.
//     `totals.unverified` is that marker.

export type BenchmarkVerdict = 'caught' | 'missed' | 'false-positive' | 'unverified';

export interface AnswerSite {
  file: string;
  lineRange: [number, number];
}

export interface AnswerKey extends AnswerSite {
  id: string;
  class: string;
  expected: 'finding' | 'clean';
  /** Equally-correct alternative sites (a cross-cutting defect has two). */
  acceptAlso?: AnswerSite[];
  severity?: string;
  defect?: string;
}

export interface ReviewerFinding {
  file?: string | undefined;
  line?: number | undefined;
  /** The schema's prose fields. `summary` is required on every finding. */
  summary?: string | undefined;
  reasoning?: string | undefined;
  grounding?: string | undefined;
}

export interface ReviewerOutput {
  critical_findings?: ReviewerFinding[] | undefined;
}

export interface ScenarioReview {
  id: string;
  /** Parsed reviewer output, or null when no review was produced. */
  review: ReviewerOutput | null;
  unverifiedReason?: string | undefined;
}

export interface BenchmarkTotals {
  caught: number;
  total: number;
  decoysClean: number;
  decoysTotal: number;
  falsePositives: number;
  unverified: number;
  recallPct: number;
  precisionPct: number;
}

export interface ScenarioScore {
  id: string;
  class: string;
  expected: 'finding' | 'clean';
  verdict: BenchmarkVerdict;
  /** How many reviewers were scored for this scenario. */
  reviews: number;
  /** The finding that matched the planted site, when one did. */
  matched: ReviewerFinding | null;
  note?: string;
}

export interface RunScore {
  totals: BenchmarkTotals;
  scenarios: ScenarioScore[];
}

/**
 * A reviewer names the file however it read it — `module.mjs`,
 * `./module.mjs`, or the repo-relative path the runner checked it out at.
 * All three name the same file, so match on the trailing segment.
 */
function sameFile(found: string | undefined, want: string): boolean {
  if (!found) return false;
  const norm = (p: string) => p.replace(/^\.\//, '').split('/').filter(Boolean);
  const a = norm(found);
  const b = norm(want);
  if (a.length === 0 || b.length === 0) return false;
  return a[a.length - 1] === b[b.length - 1];
}

/**
 * Whether a finding says enough for the scorer to compare it to a site.
 *
 * The one owner of that question: a finding with no file names no place, and
 * a `line` of `"24"` names a place this cannot compare. Either way there is
 * no site to check, and the schema's absent-line case (a cross-cutting
 * finding, where naming the file is enough) is the only one that passes
 * without a line.
 */
function placeable(finding: ReviewerFinding): boolean {
  if (!finding || typeof finding !== 'object') return false;
  if (typeof finding.file !== 'string' || finding.file.trim() === '') return false;
  if (finding.line === undefined || finding.line === null) return true;
  return Number.isInteger(finding.line) && (finding.line as number) >= 1;
}

function atSite(finding: ReviewerFinding, site: AnswerSite): boolean {
  if (!sameFile(finding.file, site.file)) return false;
  if (finding.line === undefined || finding.line === null) return true;
  return (finding.line as number) >= site.lineRange[0] && (finding.line as number) <= site.lineRange[1];
}

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether a finding this scorer cannot place names the site in its own prose.
 *
 * The only reading an unplaceable finding gets, and the only one it needs: the
 * schema makes `file` optional "when the finding is cross-cutting", so the
 * reviewer that found the defect and wrote the file's name into its summary,
 * reasoning or grounding did report it. Matched on the trailing segment, the
 * way `sameFile` matches the field — but only as a whole path token, not a
 * substring: `presort.mjs` must not credit a site named `sort.mjs`, or the
 * header invariant ("a catch must be LOCATED at the planted site") is false
 * for every leaf name that is another leaf name's suffix.
 */
function namesSite(finding: ReviewerFinding, site: AnswerSite): boolean {
  if (!finding || typeof finding !== 'object') return false;
  const text = [finding.summary, finding.reasoning, finding.grounding]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');
  const leaf = site.file.split('/').filter(Boolean).pop();
  if (leaf === undefined || leaf === '') return false;
  const token = new RegExp('(^|[^\\w.\\-/\\\\])' + escapeRegex(leaf) + '(?![\\w.])');
  return token.test(text);
}

function locatesDefect(findings: ReviewerFinding[], key: AnswerKey): ReviewerFinding | null {
  const sites: AnswerSite[] = [
    { file: key.file, lineRange: key.lineRange },
    ...(key.acceptAlso ?? []),
  ];
  for (const finding of findings) {
    const located = placeable(finding)
      ? sites.some((site) => atSite(finding, site))
      : sites.some((site) => namesSite(finding, site));
    if (located) return finding;
  }
  return null;
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Score one benchmark run against the committed answer keys.
 *
 * `reviews` may carry several entries per scenario id (one per reviewer);
 * `answerKeys` drives the output order, so a scenario nobody reviewed still
 * appears, as `unverified`.
 */
export function scoreRun(reviews: ScenarioReview[], answerKeys: AnswerKey[]): RunScore {
  const byScenario = new Map<string, ScenarioReview[]>();
  for (const entry of reviews) {
    const list = byScenario.get(entry.id) ?? [];
    list.push(entry);
    byScenario.set(entry.id, list);
  }

  const scenarios: ScenarioScore[] = answerKeys.map((key) => {
    const entries = byScenario.get(key.id) ?? [];
    const missing = entries.length === 0 ? undefined : entries.find((e) => e.review === null);

    if (entries.length === 0 || missing) {
      const note = missing?.unverifiedReason ?? 'no review produced';
      return {
        id: key.id,
        class: key.class,
        expected: key.expected,
        verdict: 'unverified' as const,
        reviews: entries.length,
        matched: null,
        note,
      };
    }

    const perReviewer = entries.map((entry) => entry.review?.critical_findings ?? []);

    if (key.expected === 'clean') {
      const flagged = perReviewer.some((findings) => findings.length > 0);
      return {
        id: key.id,
        class: key.class,
        expected: key.expected,
        verdict: flagged ? ('false-positive' as const) : ('caught' as const),
        reviews: entries.length,
        matched: null,
      };
    }

    const matches = perReviewer.map((findings) => locatesDefect(findings, key));
    const caught = matches.every((m) => m !== null);
    return {
      id: key.id,
      class: key.class,
      expected: key.expected,
      verdict: caught ? ('caught' as const) : ('missed' as const),
      reviews: entries.length,
      matched: matches.find((m) => m !== null) ?? null,
    };
  });

  const planted = scenarios.filter((s) => s.expected === 'finding' && s.verdict !== 'unverified');
  const decoys = scenarios.filter((s) => s.expected === 'clean' && s.verdict !== 'unverified');
  const caught = planted.filter((s) => s.verdict === 'caught').length;
  const decoysClean = decoys.filter((s) => s.verdict === 'caught').length;
  const falsePositives = decoys.filter((s) => s.verdict === 'false-positive').length;

  return {
    totals: {
      caught,
      total: planted.length,
      decoysClean,
      decoysTotal: decoys.length,
      falsePositives,
      unverified: scenarios.filter((s) => s.verdict === 'unverified').length,
      recallPct: pct(caught, planted.length),
      // Precision over scenario-level decisions: a caught defect is a true
      // positive, a flagged decoy a false one. With nothing flagged the ratio
      // is undefined; 0 is reported rather than a vacuous 100%, and recall
      // carries the story.
      precisionPct: pct(caught, caught + falsePositives),
    },
    scenarios,
  };
}
