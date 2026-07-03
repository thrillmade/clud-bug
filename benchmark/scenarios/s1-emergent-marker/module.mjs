// Append-only log store that packs many entries into a single text blob.
//
// On-disk format (one flat file, human-diffable):
//
//   <!-- entry-start:{id} -->
//   ...arbitrary multiline content...
//   <!-- entry-end:{id} -->
//
// Entries are separated by newlines. The reader scans line-by-line for the
// start/end marker lines and reconstructs each entry's content in between.

const START_RE = /^<!-- entry-start:(.+?) -->$/;
const END_RE = /^<!-- entry-end:(.+?) -->$/;

/**
 * Serialize a list of { id, content } entries into one flat text blob.
 * Content may be multiline (log bodies, stack traces, user notes, ...).
 */
export function serializeEntries(entries) {
  const chunks = [];
  for (const entry of entries) {
    chunks.push(`<!-- entry-start:${entry.id} -->`);
    chunks.push(entry.content); // content written through verbatim
    chunks.push(`<!-- entry-end:${entry.id} -->`);
  }
  return chunks.join("\n");
}

/**
 * Parse a blob produced by serializeEntries back into { id, content } entries.
 * Walks the blob line-by-line, opening on a start marker and closing on the
 * matching end marker; everything in between is the entry body.
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
      current = { id: start[1], content: [] };
    } else if (end && current && end[1] === current.id) {
      // Close the current entry.
      entries.push({ id: current.id, content: current.content.join("\n") });
      current = null;
    } else if (current) {
      // Ordinary body line.
      current.content.push(line);
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
