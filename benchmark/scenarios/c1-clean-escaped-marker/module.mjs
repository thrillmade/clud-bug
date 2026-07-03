// Append-only log store that packs many entries into a single text blob.
//
// On-disk format (one flat file, human-diffable frame, opaque bodies):
//
//   <!-- entry-start:{id} -->
//   {base64(content)}
//   <!-- entry-end:{id} -->
//
// This is the SAME line-marker framing as the emergent-marker store, with one
// deliberate difference: entry content is NOT written through verbatim. Each
// body is base64-encoded on write and decoded on read, so the bytes that land
// between the markers are drawn only from the base64 alphabet ([A-Za-z0-9+/=]).
//
// The marker grammar requires a line beginning with "<!-- entry-", and "<",
// "!", " " (space) are all OUTSIDE the base64 alphabet — so an encoded body
// line can never match START_RE / END_RE no matter what the *decoded* content
// contains. Ids are validated to a marker-safe charset for the same reason, so
// neither field a caller controls can forge a delimiter.

const START_RE = /^<!-- entry-start:(.+?) -->$/;
const END_RE = /^<!-- entry-end:(.+?) -->$/;

// Ids go into the marker line un-encoded (to keep the frame human-diffable), so
// they must not be able to smuggle a space, "<", "-->", or newline. This charset
// contains none of those, so a validated id can never forge or split a marker.
const ID_RE = /^[A-Za-z0-9._-]+$/;

function encodeBody(content) {
  // utf8 -> base64. Output alphabet is [A-Za-z0-9+/=] on a single line: no "<",
  // no space, no newline — so it is disjoint from the marker grammar.
  return Buffer.from(content, "utf8").toString("base64");
}

function decodeBody(b64) {
  return Buffer.from(b64, "base64").toString("utf8");
}

/**
 * Serialize a list of { id, content } entries into one flat text blob.
 * Content may be multiline (log bodies, stack traces, user notes, ...); it is
 * base64-encoded so arbitrary bytes survive the flat-file framing intact.
 */
export function serializeEntries(entries) {
  const chunks = [];
  for (const entry of entries) {
    if (!ID_RE.test(entry.id)) {
      throw new Error(`unsafe entry id: ${JSON.stringify(entry.id)}`);
    }
    chunks.push(`<!-- entry-start:${entry.id} -->`);
    chunks.push(encodeBody(entry.content)); // opaque base64, one line
    chunks.push(`<!-- entry-end:${entry.id} -->`);
  }
  return chunks.join("\n");
}

/**
 * Parse a blob produced by serializeEntries back into { id, content } entries.
 * Walks the blob line-by-line, opening on a start marker and closing on the
 * matching end marker; the body line(s) in between are base64-decoded.
 */
export function parseEntries(blob) {
  const lines = blob.split("\n");
  const entries = [];
  let current = null;

  for (const line of lines) {
    const start = line.match(START_RE);
    const end = line.match(END_RE);

    if (start) {
      // Begin a new entry.
      current = { id: start[1], body: [] };
    } else if (end && current && end[1] === current.id) {
      // Close the current entry: decode the accumulated base64 body.
      entries.push({ id: current.id, content: decodeBody(current.body.join("")) });
      current = null;
    } else if (current) {
      // Opaque base64 body line (never matches a marker).
      current.body.push(line);
    }
    // Lines outside any entry are ignored.
  }

  return entries;
}

/** Convenience: round-trip a list of entries through the flat-file format. */
export function roundTrip(entries) {
  return parseEntries(serializeEntries(entries));
}

/** Look up a single entry's content by id after a round-trip. */
export function readById(blob, id) {
  const found = parseEntries(blob).find((e) => e.id === id);
  return found ? found.content : null;
}
