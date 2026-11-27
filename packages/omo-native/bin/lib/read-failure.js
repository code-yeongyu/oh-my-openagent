/**
 * What a setup notice may say about a file it could not read. The files setup inspects hold
 * credentials, and a runtime's error text can quote them: V8's JSON.parse repeats the source around
 * an unexpected token (the whole of a short file, a window of a long one), and JavaScriptCore names
 * the offending identifier. So a notice never carries `error.message`; it names the file and the
 * operation, and this module adds at most a kind and a position from a fixed vocabulary.
 */

// V8 reports where a parse stopped as "at position N (line L column C)"; only the digits are kept.
const V8_POSITION = /at position (\d+)(?: \(line (\d+) column (\d+)\))?/

function parsePosition(message) {
  const match = V8_POSITION.exec(message)
  if (match === null) return ""
  return match[2] === undefined ? ` at position ${match[1]}` : ` at line ${match[2]} column ${match[3]}`
}

/** A kind (and for a parse error, a position) safe to show next to a credential file's name. */
export function describeReadFailure(error) {
  if (error instanceof SyntaxError) return `not valid JSON${parsePosition(String(error.message))}`
  // node:sqlite on Node and Bun: `errstr` is SQLite's own text for the result code
  // (sqlite3_errstr), a fixed table that never contains the database's contents.
  if (typeof error?.errcode === "number" && typeof error.errstr === "string") return `SQLite: ${error.errstr}`
  // A filesystem error code (EACCES, EISDIR, ...) and the path it was raised for name the failure
  // without the file's bytes; the path is what a notice already shows.
  if (typeof error?.code === "string" && /^E[A-Z0-9]+$/.test(error.code))
    return typeof error.path === "string" ? `${error.code} (${error.path})` : error.code
  return "an unexpected error"
}
