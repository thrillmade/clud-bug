import type { ReviewRole } from './review-plan.js';
import {
  flattenFindings,
  type Finding,
  type Review,
  type Severity,
} from './review-schema-zod.js';
import type {
  Consensus,
  MultiPassReview,
  PassAttribution,
  PassSource,
  ReviewPassMode,
  UnifiedFinding,
} from './review-writeback.js';

/**
 * Multi-pass aggregator.
 *
 * Takes N passes' review outputs + the active mode + the role definitions
 * and produces a single unified `MultiPassReview` payload the renderer can
 * format with per-pass attribution inline.
 *
 * The three modes are NOT interchangeable in their output shape — see the
 * per-mode comments below.
 *
 * Design discipline:
 *   - Pure function. No I/O, no AI calls. Input = N validated reviews +
 *     metadata; output = aggregated findings list.
 *   - Order-stable. The renderer needs a deterministic finding order so the
 *     comment is stable across re-reviews (matters for thread continuity in
 *     D.2.6). We preserve Pass 1's order, then append later-pass findings.
 *   - Match semantics live here. Two findings are "the same" if their
 *     (file, line, skill) tuple matches. Summaries diverge stylistically
 *     between passes; key matching on summary is too brittle.
 *   - Resolution rules:
 *       cross-check   → Pass 2 explicitly classified Pass-1 findings as
 *                       agreed/disagreed via the cross-check schema; we use
 *                       its verdict verbatim.
 *       consensus     → Pass 2 ran independent. Same-tuple findings across
 *                       passes are marked `agreed`; tuple-unique findings are
 *                       attributed to their pass with provenance.
 *       independent   → No merging. We emit a flat list with one entry per
 *                       (pass, finding) — the renderer formats them as a
 *                       side-by-side review block.
 *
 * The orchestrator owns the AI call orchestration upstream. This module just
 * deals with shapes — call it once per skill (or once per shared bundle).
 *
 * Ported from clud-bug-app/lib/multi-pass-aggregator.ts. The result types
 * (`MultiPassReview`, `UnifiedFinding`, `PassAttribution`, `PassSource`,
 * `ReviewPassMode`) live in `./review-writeback.ts` and are imported here so
 * core has a single declaration for each. The aggregator-internal contracts
 * (`PassSource` is shared; `Consensus`, `CrossCheckVerdict`,
 * `CrossCheckPassResult`, `AggregateInput`) are defined below.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

// `Consensus` (the SPEC §6.10.1 marker) is defined in `./review-writeback.ts`
// alongside `UnifiedFinding` and imported above — core keeps a single
// declaration so it rides on `MultiPassReview.findings[].consensus`.

/**
 * Derive the SPEC §6.10.1 consensus marker from a finding's per-pass
 * attribution list. Mapping rules:
 *
 *   - any source === 'agreed'    → '2-of-2' (consensus reached)
 *   - any source === 'disagreed' → 'arbitrated' (cross-check produced
 *     active dissent; the finding still made it through, which is the
 *     arbitration outcome we model today — see Consensus type doc)
 *   - otherwise (just 'first' / 'independent') → '1-of-N' (single-pass)
 *
 * Priority order: agreed > disagreed > default. If a finding has BOTH
 * an `agreed` and a `disagreed` attribution (e.g., 3-pass setup with
 * Pass 2 agreed + Pass 3 disagreed), `agreed` wins — at least one pass
 * cross-validated the finding, so the gate has consensus.
 */
export function deriveConsensus(attributions: PassAttribution[]): Consensus {
  let sawDisagreed = false;
  for (const a of attributions) {
    if (a.source === 'agreed') return '2-of-2';
    if (a.source === 'disagreed') sawDisagreed = true;
  }
  return sawDisagreed ? 'arbitrated' : '1-of-N';
}

// (Removed `UnifiedFindingWithConsensus`: core's `UnifiedFinding` now carries
// the optional `consensus` field directly — see `./review-writeback.ts` — so
// `finalize()` returns `UnifiedFinding[]` and `aggregatePasses(...).findings[i]
// .consensus` is on the PUBLIC return type, not erased at the boundary.)

// ---------------------------------------------------------------------------
// Cross-check schema (what Pass 2 returns under mode: cross-check)
// ---------------------------------------------------------------------------

/**
 * The cross-check pass returns:
 *   - One verdict per Pass-1 finding (agreed / disagreed + rationale).
 *   - A list of independently-discovered findings (same shape as Finding).
 *
 * We define the response shape here (not in review-schema-zod.ts) because
 * it's an aggregator-internal contract. The orchestrator uses
 * `crossCheckSchema` (from review-schema-zod) for the AI call output type.
 */
export interface CrossCheckVerdict {
  /** 0-indexed reference to the Pass-1 finding being judged. */
  pass1Index: number;
  /** Pass 2's verdict. */
  verdict: 'agreed' | 'disagreed';
  /** One-line rationale shown inline. Optional but recommended. */
  rationale?: string;
}

export interface CrossCheckPassResult {
  /** Per-Pass-1-finding judgements. */
  verdicts: CrossCheckVerdict[];
  /** Newly-discovered findings, independent of Pass 1's list. */
  independentFindings: Finding[];
}

// ---------------------------------------------------------------------------
// Aggregation entry point
// ---------------------------------------------------------------------------

export interface AggregateInput {
  /** Mode driving the merge. */
  mode: ReviewPassMode;
  /** Pass 1's review. Required — at minimum we need one pass. */
  firstPass: Review;
  /**
   * Subsequent passes. Shape depends on mode:
   *   - cross-check: each entry has `crossCheck` populated; `review` may be
   *     omitted (the cross-check pass doesn't produce a full review object).
   *   - consensus / independent: each entry has `review` populated; the
   *     `crossCheck` field is ignored.
   */
  subsequentPasses: Array<{
    /** 1-indexed pass number, starting at 2. */
    passNumber: number;
    /** Role label + model used. */
    role: ReviewRole;
    /** Cross-check response (only valid when mode === 'cross-check'). */
    crossCheck?: CrossCheckPassResult;
    /** Full review (for consensus / independent modes). */
    review?: Review;
  }>;
  /** Role assigned to Pass 1 — needed for attribution headers. */
  firstPassRole: ReviewRole;
}

/**
 * Merges the per-pass results into a single MultiPassReview.
 */
export function aggregatePasses(input: AggregateInput): MultiPassReview {
  switch (input.mode) {
    case 'cross-check':
      return aggregateCrossCheck(input);
    case 'consensus':
      return aggregateConsensus(input);
    case 'independent':
      return aggregateIndependent(input);
  }
}

// ---------------------------------------------------------------------------
// 6c — conditional Mantis-arbiter escalation
// ---------------------------------------------------------------------------

export interface EscalationInput {
  /** Active aggregation mode — escalation only applies to cross-check. */
  mode: ReviewPassMode;
  /** Resolved pass count — escalation only when the plan ran exactly 2. */
  passCount: number;
  /** Pass 1's review; its findings are indexed by the cross-check verdicts. */
  firstPass: Review;
  /** Subsequent passes — the cross-check verdicts live here. */
  subsequentPasses: AggregateInput['subsequentPasses'];
}

/**
 * 6c arbiter gate (SPEC §6.10.1 `arbitrated`). Returns true when a 2-pass
 * cross-check disagreed on a gate-relevant (`critical` | `minor`) Pass-1
 * finding — the only case worth spending a 3rd Mantis arbiter pass on. Pure:
 * it reads the verdicts Pass 2 already produced; no I/O, no AI call.
 *
 * Scope rationale:
 *   - cross-check only — `consensus` already runs Mantis as its final pass and
 *     `independent` has no arbiter; both return false.
 *   - `passCount === 2` (not `>= 2`) — a statically-configured 3-pass
 *     cross-check already runs Mantis as pass 3 via the loop, so escalating
 *     there would stack a redundant 4th pass past MAX_PASSES.
 *   - severity `critical | minor` — a `preexisting` dispute can never flip the
 *     merge gate, so it doesn't earn an Opus-class arbiter.
 *
 * Authority is marker-only: the arbiter's verdict sets the disputed finding's
 * consensus marker + rationale; it does not change which findings gate the
 * merge (that stays `resolveVerdict`'s job).
 */
export function shouldEscalate(input: EscalationInput): boolean {
  if (input.mode !== 'cross-check' || input.passCount !== 2) return false;
  const pass1 = flattenFindings(input.firstPass);
  return input.subsequentPasses.some((pass) =>
    (pass.crossCheck?.verdicts ?? []).some((v) => {
      if (v.verdict !== 'disagreed') return false;
      const severity = pass1[v.pass1Index]?.severity;
      return severity === 'critical' || severity === 'minor';
    }),
  );
}

// ---------------------------------------------------------------------------
// Mode: cross-check
// ---------------------------------------------------------------------------

/**
 * Cross-check: Pass 2 saw Pass 1's findings + the diff. Each Pass-1 finding
 * gets a per-pass-2 verdict; Pass 2's independent findings are appended.
 *
 * Output order:
 *   1. Pass-1 findings in original order, each with their pass-2 verdict
 *      attribution attached (one PassAttribution for Pass 1, one for Pass 2
 *      if applicable, etc.).
 *   2. Pass-2 (and beyond) independent findings, in pass order.
 */
function aggregateCrossCheck(input: AggregateInput): MultiPassReview {
  const findings: UnifiedFinding[] = [];
  const firstRoleAttribution = (
    _f: Finding,
    source: PassSource = 'first',
  ): PassAttribution => ({
    passNumber: 1,
    roleName: input.firstPassRole.name,
    model: input.firstPassRole.model,
    source,
  });

  // Initialize the unified list with Pass 1's findings. Wire-shape Review
  // splits findings across 3 severity arrays; flatten to internal Finding[].
  for (const f of flattenFindings(input.firstPass)) {
    findings.push({
      ...f,
      attributions: [firstRoleAttribution(f)],
    });
  }

  // Layer in each subsequent pass's verdicts + independent findings.
  for (const pass of input.subsequentPasses) {
    if (!pass.crossCheck) continue; // mis-configured input; skip cleanly
    // 1. Verdicts on Pass-1 findings — attach a PassAttribution per verdict.
    for (const v of pass.crossCheck.verdicts) {
      const target = findings[v.pass1Index];
      if (!target) continue; // out-of-range index — ignore
      target.attributions.push({
        passNumber: pass.passNumber,
        roleName: pass.role.name,
        model: pass.role.model,
        source: v.verdict,
        // exactOptionalPropertyTypes: omit `note` entirely when the pass
        // supplied no rationale (vs. setting it to `undefined`). Behavior is
        // identical for every consumer (renderer/tests read `note` only when
        // present); the App relied on a looser tsconfig where `note:
        // undefined` was allowed.
        ...(v.rationale !== undefined ? { note: v.rationale } : {}),
      });
    }
    // 2. Independent findings — append with provenance.
    for (const f of pass.crossCheck.independentFindings) {
      findings.push({
        ...f,
        attributions: [
          {
            passNumber: pass.passNumber,
            roleName: pass.role.name,
            model: pass.role.model,
            source: 'independent',
          },
        ],
      });
    }
  }

  return finalize({
    mode: 'cross-check',
    findings,
    firstPassRole: input.firstPassRole,
    subsequentPasses: input.subsequentPasses,
  });
}

// ---------------------------------------------------------------------------
// Mode: consensus
// ---------------------------------------------------------------------------

/**
 * Consensus: every pass ran fully independent of the others. We diff the
 * passes pairwise and label same-tuple findings as `agreed` (intersection)
 * and tuple-unique findings as `first` / `independent` per pass.
 *
 * Output order:
 *   1. Pass 1's findings in original order (each enriched with `agreed`
 *      attributions if other passes also raised the same tuple).
 *   2. Tuple-unique findings from later passes, in pass-number order.
 */
function aggregateConsensus(input: AggregateInput): MultiPassReview {
  const findings: UnifiedFinding[] = [];

  // Index Pass 1's findings by tuple → list index.
  const tupleToIndex = new Map<string, number>();
  flattenFindings(input.firstPass).forEach((f, i) => {
    findings.push({
      ...f,
      attributions: [
        {
          passNumber: 1,
          roleName: input.firstPassRole.name,
          model: input.firstPassRole.model,
          source: 'first',
        },
      ],
    });
    tupleToIndex.set(tupleKey(f), i);
  });

  for (const pass of input.subsequentPasses) {
    if (!pass.review) continue;
    for (const f of flattenFindings(pass.review)) {
      const key = tupleKey(f);
      const existingIndex = tupleToIndex.get(key);
      if (existingIndex !== undefined) {
        // Same-tuple match → consensus. Append an "agreed" attribution.
        const target = findings[existingIndex];
        if (!target) continue;
        target.attributions.push({
          passNumber: pass.passNumber,
          roleName: pass.role.name,
          model: pass.role.model,
          source: 'agreed',
        });
        // Promote severity if this pass flagged it higher (e.g. Pass 1 minor,
        // Pass 2 critical — we keep the more conservative critical).
        if (severityRank(f.severity) > severityRank(target.severity)) {
          target.severity = f.severity;
        }
      } else {
        // New tuple — append + index for future passes.
        const newIdx = findings.length;
        findings.push({
          ...f,
          attributions: [
            {
              passNumber: pass.passNumber,
              roleName: pass.role.name,
              model: pass.role.model,
              source: 'independent',
            },
          ],
        });
        tupleToIndex.set(key, newIdx);
      }
    }
  }

  return finalize({
    mode: 'consensus',
    findings,
    firstPassRole: input.firstPassRole,
    subsequentPasses: input.subsequentPasses,
  });
}

// ---------------------------------------------------------------------------
// Mode: independent
// ---------------------------------------------------------------------------

/**
 * Independent: no merging. Every finding from every pass is emitted with
 * `source: 'first'` (Pass 1) or `source: 'independent'` (Pass N > 1). The
 * renderer is responsible for formatting as side-by-side blocks.
 *
 * Output order: Pass 1's findings, then Pass 2's, then Pass 3's — preserving
 * each pass's internal order.
 */
function aggregateIndependent(input: AggregateInput): MultiPassReview {
  const findings: UnifiedFinding[] = [];
  for (const f of flattenFindings(input.firstPass)) {
    findings.push({
      ...f,
      attributions: [
        {
          passNumber: 1,
          roleName: input.firstPassRole.name,
          model: input.firstPassRole.model,
          source: 'first',
        },
      ],
    });
  }
  for (const pass of input.subsequentPasses) {
    if (!pass.review) continue;
    for (const f of flattenFindings(pass.review)) {
      findings.push({
        ...f,
        attributions: [
          {
            passNumber: pass.passNumber,
            roleName: pass.role.name,
            model: pass.role.model,
            source: 'independent',
          },
        ],
      });
    }
  }
  return finalize({
    mode: 'independent',
    findings,
    firstPassRole: input.firstPassRole,
    subsequentPasses: input.subsequentPasses,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Tuple-key used to detect "same finding" across passes.
 *
 * We key on (file, line, skill) instead of summary because:
 *   - Summaries vary stylistically between passes (Sonnet vs Opus phrasing).
 *   - File + line + cited skill is the SPEC §1.8.1 minimum identity unit.
 *   - File-level findings (no line) collapse to the same tuple regardless of
 *     phrasing, which is the desired consensus semantic.
 */
function tupleKey(f: Finding): string {
  return `${f.file}::${f.line ?? '*'}::${f.skill}`;
}

function severityRank(s: Severity): number {
  switch (s) {
    case 'critical':
      return 3;
    case 'minor':
      return 2;
    case 'preexisting':
      return 1;
  }
}

interface FinalizeInput {
  mode: ReviewPassMode;
  /**
   * Pre-consensus shape — aggregators build these without populating
   * the `consensus` field; `finalize()` is the single derivation point
   * via `deriveConsensus(attributions)`. Keeping aggregators free of
   * the consensus concern avoids drift between cross-check / consensus
   * / independent paths (one mapping rule, three call sites).
   */
  findings: UnifiedFinding[];
  firstPassRole: ReviewRole;
  subsequentPasses: AggregateInput['subsequentPasses'];
}

function finalize(input: FinalizeInput): MultiPassReview {
  const passCount = 1 + input.subsequentPasses.length;
  const roles = [
    {
      passNumber: 1,
      roleName: input.firstPassRole.name,
      model: input.firstPassRole.model,
    },
    ...input.subsequentPasses.map((p) => ({
      passNumber: p.passNumber,
      roleName: p.role.name,
      model: p.role.model,
    })),
  ];

  // SPEC §6.10.1 consensus marker — single derivation point.
  // Aggregators emit findings without `consensus`; this map adds it
  // from the accumulated per-pass attributions. Renderer + auto-fix
  // gate both consume `finding.consensus` downstream.
  const findingsWithConsensus: UnifiedFinding[] = input.findings.map(
    (f) => ({
      ...f,
      consensus: deriveConsensus(f.attributions),
    }),
  );

  // Derive summary counts + skills_referenced from the aggregated list.
  const counts = {
    critical: findingsWithConsensus.filter((f) => f.severity === 'critical').length,
    minor: findingsWithConsensus.filter((f) => f.severity === 'minor').length,
    preexisting: findingsWithConsensus.filter((f) => f.severity === 'preexisting')
      .length,
    resolved_from_prior: 0,
    still_open: 0,
  };
  const skillsReferenced = uniqInOrder(findingsWithConsensus.map((f) => f.skill));

  // Status header logic:
  //  - empty → "clean"
  //  - any critical → "critical findings"
  //  - else → "clean" (minor + preexisting alone don't headline as critical)
  const status_header =
    counts.critical > 0
      ? ('critical findings' as const)
      : ('clean' as const);

  // Verdict resolution — see resolveVerdict for the per-mode rules.
  const verdict = resolveVerdict(input.mode, findingsWithConsensus, passCount);

  return {
    status_header,
    summary_counts: counts,
    skills_referenced: skillsReferenced,
    findings: findingsWithConsensus,
    mode: input.mode,
    passCount,
    roles,
    verdict,
  };
}

function uniqInOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    if (seen.has(it)) continue;
    seen.add(it);
    out.push(it);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Verdict resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the APPROVE / REQUEST_CHANGES verdict per the SPEC §1.8.5 table:
 *
 *   mode          | request_changes when…
 *   --------------+------------------------------------------------------
 *   strict (=cross-check default) | ANY pass flagged critical
 *   consensus     | ≥2 passes flagged the same critical tuple
 *   independent   | findings side-by-side — human decides per finding.
 *                 | For automation purposes we treat ANY critical as
 *                 | request_changes (safer default; humans can downgrade).
 *
 * We expose this both as a return field on `MultiPassReview.verdict` and
 * separately (for tests + future D.2 wiring) as `resolveVerdict`.
 *
 * NOTE: The broader D.2 phase wires APPROVE/REQUEST_CHANGES into actual
 * PR check states. D.2.5 only computes the verdict — surfacing it is left
 * to the renderer (which prefixes the header line with the verdict label).
 */
export function resolveVerdict(
  mode: ReviewPassMode,
  findings: UnifiedFinding[],
  passCount: number,
): MultiPassReview['verdict'] {
  if (findings.length === 0) return 'clean';
  const criticals = findings.filter((f) => f.severity === 'critical');
  if (criticals.length === 0) return 'review_only';

  switch (mode) {
    case 'cross-check':
    case 'independent':
      // Strict: any critical → request_changes.
      return 'request_changes';
    case 'consensus':
      // ≥2 passes must agree on the same critical tuple.
      // Single-pass consensus is degenerate but valid — any critical fires.
      if (passCount < 2) return 'request_changes';
      for (const f of criticals) {
        // Spec: "≥2 passes flagged the same critical tuple."
        // Each attribution represents exactly one pass, so the correct
        // count is f.attributions.length. The earlier filter on
        // `source === 'first' | 'agreed'` silently dropped findings
        // raised by Pass 2 + confirmed by Pass 3 but missed by Pass 1
        // (attributions = [independent, agreed], neither matches → the
        // consensus gate never fired).
        if (f.attributions.length >= 2) return 'request_changes';
      }
      return 'review_only';
  }
}
