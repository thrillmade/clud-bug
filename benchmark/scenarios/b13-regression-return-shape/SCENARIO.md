---
id: b13-regression-return-shape
class: combinatorial
severity: MED-HIGH
one_line_defect: A DRY refactor routes expandRule's return through a shared `collapse` helper that unwraps a one-item list into a bare element, so for the specific input of a rule with exactly one known channel expandRule returns a single spec object instead of a one-element array, breaking every caller that iterates its result.
reproduction: node reproduce.mjs
why_no_single_line: No single line is wrong — `collapse` (unwrap a singleton list) is a legitimate utility and is used correctly by resolveDefault, whose contract IS a single spec; `return collapse(specs)` is a defensible reuse; and `for (const spec of expandRule(rule))` is a defensible way to consume an array. The defect is the contract MISMATCH between the two builders that share `collapse` (single-value vs array), and it only bites when an input expands to exactly one element — a combination no line quotes.
correct_finding: Report that expandRule's array-return contract is broken because it reuses the singleton-unwrapping `collapse` helper: for a rule with exactly one known channel it returns a bare {event, channel} object instead of a one-element array, so iterating callers (buildDeliveryPlan's `for...of`) get a non-iterable and throw. Ground it either by running `node reproduce.mjs` (expandRule of a single-channel rule returns a bare object; buildDeliveryPlan throws) or by naming the invariant (expandRule must always return an array of specs; `collapse` is only shape-correct where a single value is the contract, i.e. resolveDefault).
---

`expandRule` must always return an ARRAY of delivery specs; `resolveDefault` must
return a SINGLE spec. This PR extracts a `collapse(list)` helper — return the sole
element when the list has one, else the list — and uses it in both builders. In
`resolveDefault` that is exactly right. In `expandRule` it is right for two-or-more
channels and for zero channels (which wraps the default in an array), but for a rule
whose usable channels number exactly one, `collapse` unwraps the freshly-built
one-item `specs` list and `expandRule` returns a bare `{event, channel}` object.
Callers that iterate the result — `buildDeliveryPlan` does `for (const spec of
expandRule(rule))` — then receive a non-iterable and throw. The bug needs both the
shared-helper reuse and a single-element input; drop either (two channels, no
channels, or don't share `collapse`) and the output is correct.

**Fix:** don't collapse where the contract is an array — in `expandRule` return the
list directly (`return specs;`), or use a shape-preserving helper. Keep `collapse`
only in `resolveDefault`, where a single value is the actual contract.
