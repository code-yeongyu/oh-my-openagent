// Shared by the unbundled Node CLI and the SDK/tool bundles. Keep cursor syntax independent of session I/O.
export const THREAD_TAIL_MAX_ITEMS = 200
const CURSOR_VERSION = "t1"
const OLDER_CURSOR_VERSION = "t1o"
const FILE_TAIL_CURSOR_VERSION = "t1t"

export function encodeTranscriptCursor(cursor) {
  if (cursor.direction === "file_scan")
    return Buffer.from(`t1s:${cursor.revision}:${cursor.offset}:${Number(cursor.skip)}`).toString("base64url")
  const text =
    cursor.direction === "forward"
      ? `${CURSOR_VERSION}:${cursor.revision}:${cursor.offset}`
      : cursor.direction === "older"
        ? `${OLDER_CURSOR_VERSION}:${cursor.revision}:${cursor.before}:${cursor.floor}`
        : `${FILE_TAIL_CURSOR_VERSION}:${cursor.revision}:${cursor.before}:${cursor.count}`
  return Buffer.from(text, "utf8").toString("base64url")
}

const ENTRY_CURSOR_VERSION = "t3"
/** Entry cursors earlier builds issued (`t2`: revision and one entry id); their positions mean something else now (#14180). */
const RETIRED_CURSOR_VERSIONS = new Set(["t2"])

export function encodeEntryCursor({ revision, before, floor }) {
  return Buffer.from(`${ENTRY_CURSOR_VERSION}\n${revision}\n${before}\n${floor}`, "utf8").toString("base64url")
}

function parseEntry(text) {
  const parts = text.split("\n")
  const [version = "", revision = "", before = "", floor = ""] = parts
  if (!revision || !before) return null
  // A well-formed retired cursor is stale, not invalid (#14180).
  if (parts.length === 3 && RETIRED_CURSOR_VERSIONS.has(version)) return "retired"
  return parts.length === 4 && version === ENTRY_CURSOR_VERSION && floor ? { revision, before, floor } : null
}

function unpack(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null
  const text = Buffer.from(raw, "base64url").toString("utf8")
  return Buffer.from(text).toString("base64url") === raw ? text : null
}

function parseTranscript(decoded) {
  const [version, revision = "", ...positions] = decoded.split(":")
  if (!/^\d+\.[0-9a-z]+$/.test(revision)) return null
  if (positions.some((position) => !/^\d+$/.test(position))) return null
  const offsets = positions.map(Number)
  if (offsets.some((offset) => !Number.isSafeInteger(offset) || offset < 0)) return null
  const [first = 0, second = 0] = offsets
  if (
    version === "t1s" &&
    /^\d+\.[0-9a-f]{64}$/.test(revision) &&
    offsets.length === 2 &&
    first <= Number(revision.split(".")[0]) &&
    (second === 0 || second === 1)
  )
    return { direction: "file_scan", revision, offset: first, skip: second === 1 }
  if (version === CURSOR_VERSION && offsets.length === 1) return { direction: "forward", revision, offset: first }
  if (version === OLDER_CURSOR_VERSION && offsets.length === 2 && second <= first)
    return { direction: "older", revision, before: first, floor: second }
  if (
    version === FILE_TAIL_CURSOR_VERSION &&
    /^\d+\.[0-9a-f]{64}$/.test(revision) &&
    offsets.length === 2 &&
    first <= second &&
    second > 0 &&
    second <= THREAD_TAIL_MAX_ITEMS
  )
    return { direction: "file_tail", revision, before: first, count: second }
  return null
}

export function decodeTranscriptCursor(raw) {
  const text = unpack(raw)
  return text === null ? null : parseTranscript(text)
}

export function decodeEntryCursor(raw) {
  const text = unpack(raw)
  return text === null ? null : parseEntry(text)
}

export function isReadCursor(raw) {
  const text = unpack(raw)
  return text !== null && (parseTranscript(text) !== null || parseEntry(text) !== null)
}
