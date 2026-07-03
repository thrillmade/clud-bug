---
id: s1-emergent-marker
class: emergent
severity: MAJOR
one_line_defect: serializeEntries writes entry content verbatim, so a body line that looks like a col-0 `<!-- entry-start/end:... -->` marker forges a delimiter and the reader mis-frames entries (phantom entry appears, real entry evicted).
reproduction: node reproduce.mjs
why_no_single_line: Every writer line is a correct plain string concat and every reader line is a correct marker scan; the corruption only exists in the *interaction* of unescaped content with the line-based framing, never on any one changed line.
correct_finding: Report that the serialization format is not injection-safe — entry content is not escaped/guarded, so multiline content containing a column-0 marker line forges a delimiter and breaks the parse round-trip. Ground it either by running `node reproduce.mjs` (round-trip is not the identity: `note-1001` evicted, `phantom` appears) or by naming the violated invariant: `parseEntries(serializeEntries(x))` must equal `x`, which fails whenever content can contain a line matching the marker grammar.
---

The store flattens entries into one text blob delimited by `<!-- entry-start:{id} -->` / `<!-- entry-end:{id} -->` marker lines, but `serializeEntries` pushes `entry.content` through unmodified. Because the marker grammar is "any line matching the regex at column 0," untrusted multiline content (a user note that quotes the format, a stack trace, a pasted log) can contain a line that IS a marker. When flattened, that forged marker is byte-identical to a real one, so `parseEntries` opens a phantom entry mid-body, discards the in-progress real entry (it's overwritten before its true end marker is seen), and the real entry's genuine end marker is then dropped as stray text — the real entry is silently evicted and a phantom takes its place.

The fix is to make content and framing unambiguous: escape or neutralize any content line that matches the marker grammar on write (e.g. prefix-escape lines beginning with `<!-- entry-`), or abandon line-marker framing for a length-prefixed / count-prefixed encoding (write the content byte length before the body so the reader never has to guess where content ends). Either restores the `parse(serialize(x)) === x` invariant regardless of what bytes appear in `content`.
