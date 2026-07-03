---
id: c1-clean-escaped-marker
class: clean
severity: none
one_line_defect: NONE — this code is correct
reproduction: node reproduce.mjs
why_correct: Bodies are base64-encoded before writing, and the base64 alphabet ([A-Za-z0-9+/=]) is disjoint from the marker grammar (no "<", "!", or space), so an encoded body line can never forge a delimiter regardless of the decoded content.
correct_finding: NONE. A correct review reports no finding here; any critical/major flag is a FALSE POSITIVE.
---

This is the precision decoy for `s1-emergent-marker`: identical line-marker framing (`<!-- entry-start:{id} -->` / `<!-- entry-end:{id} -->`) fed the identical adversarial input — a user note whose column-0 body line is byte-for-byte a marker. The bug-prone SHAPE is real, so a hasty reviewer sees "marker-based serialization" and cries injection. But `serializeEntries` base64-encodes every body before writing, so the bytes that land between markers come only from `[A-Za-z0-9+/=]`; the marker grammar requires a leading `<!-- entry-`, and `<`/`!`/space are outside that alphabet, making a forged delimiter impossible — and ids are validated to a marker-safe charset so the other caller-controlled field can't forge one either. The `parse(serialize(x)) === x` invariant genuinely holds for arbitrary content (multiline, empty, Unicode, all-marker-shaped), so the only correct output is no finding.
