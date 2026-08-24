← back to [docs/timeline.md](../timeline.md)

## 2026-08-24 09:05 - Caption benchmark/RESULTS.md and README.md: Phase R methodology is superseded by SPEC 2.0 §4.7

**Reasoning:** Both docs still asserted unqualified 100% recall + 100% precision, 'Seeded-benchmark criterion: MET', and grounding by 'a reproduction the reviewer wrote + ran' — the exact reviewer-execution capability SPEC 2.0 §4.7 bans and clud-bug#281 deleted; site/app/page.tsx and docs/multi-pass already carry this caveat on dev but the source docs they link to did not

**Alternatives considered:** delete the historical numbers — rejected: they are a true record of a real measurement under Phase R, and PR#281's own description says to caption them as superseded, not erase them

**Implications:**
- the numbers are unchanged; every claim of current validity now points at the caveat. A fresh benchmark run against the CI-evidence recipe is still pending — not done by this change

---

