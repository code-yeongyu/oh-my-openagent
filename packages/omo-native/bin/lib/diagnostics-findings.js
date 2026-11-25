// @ts-check
// Findings and repairs as data, and their one rendering: `<PREFIX> <message>` per line, the format
// `omo doctor` has always printed. Sections that still produce lines are read back through the closed
// prefix sets here, so an unknown prefix is a programming error, never a silently renamed line.

/** @typedef {import("./diagnostics-contract").DiagnosticFinding} DiagnosticFinding */
/** @typedef {import("./diagnostics-contract").DiagnosticCheck} DiagnosticCheck */
/** @typedef {import("./diagnostics-contract").DiagnosticLevel} DiagnosticLevel */
/** @typedef {import("./diagnostics-contract").FixEntry} FixEntry */

/** @type {Readonly<Record<DiagnosticLevel, string>>} */
const LEVEL_PREFIX = { ok: "PASS", notice: "INFO", warn: "WARN", fail: "FAIL" }

/**
 * @template {string} K
 * @param {Readonly<Record<K, string>>} prefixes
 * @param {string} line
 * @returns {{ key: K, message: string }}
 */
function splitPrefix(prefixes, line) {
  for (const [key, prefix] of /** @type {[K, string][]} */ (Object.entries(prefixes))) {
    if (line.startsWith(`${prefix} `)) return { key, message: line.slice(prefix.length + 1) }
  }
  throw new TypeError(`diagnostics: a line without a known prefix: ${JSON.stringify(line)}`)
}

/**
 * @param {DiagnosticCheck} check
 * @param {DiagnosticLevel} level
 * @param {string} message
 * @param {Readonly<Record<string, unknown>>} [details]
 * @returns {DiagnosticFinding}
 */
export function finding(check, level, message, details) {
  return details === undefined ? { level, check, message } : { level, check, message, details }
}

/**
 * @param {DiagnosticCheck} check
 * @param {readonly string[]} lines
 * @returns {DiagnosticFinding[]}
 */
export function findingsFromLines(check, lines) {
  return lines.map((line) => {
    const { key, message } = splitPrefix(LEVEL_PREFIX, line)
    return finding(check, key, message)
  })
}

/** @param {readonly Pick<DiagnosticFinding, "level" | "message">[]} findings */
export function renderFindings(findings) {
  return findings.map((entry) => `${LEVEL_PREFIX[entry.level]} ${entry.message}`)
}

/** @param {readonly FixEntry[]} entries */
export function renderFixEntries(entries) {
  return entries.map((entry) =>
    entry.kind === "sweep_text" ? entry.text : `${LEVEL_PREFIX[entry.level]} ${entry.message}`,
  )
}
