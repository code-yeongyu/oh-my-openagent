// @ts-check
// Findings and repairs as data, and their one rendering: `<PREFIX> <message>` per line, the format
// `omo doctor` has always printed. Sections that still produce lines are read back through the closed
// prefix sets here, so an unknown prefix is a programming error, never a silently renamed line.

/** @typedef {import("./diagnostics-contract").DiagnosticFinding} DiagnosticFinding */
/** @typedef {import("./diagnostics-contract").DiagnosticCheck} DiagnosticCheck */
/** @typedef {import("./diagnostics-contract").DiagnosticLevel} DiagnosticLevel */
/** @typedef {import("./diagnostics-contract").FixEntry} FixEntry */
/** @typedef {import("./diagnostics-contract").RepairOutcome} RepairOutcome */

/** @type {Readonly<Record<DiagnosticLevel, string>>} */
const LEVEL_PREFIX = { ok: "PASS", notice: "INFO", warn: "WARN", fail: "FAIL" }

/** @type {Readonly<Record<RepairOutcome, string>>} */
const REPAIR_PREFIX = { fixed: "FIXED", would_fix: "WOULD FIX", kept: "KEPT" }

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

/** @param {readonly DiagnosticFinding[]} findings */
export function renderFindings(findings) {
  return findings.map((entry) => `${LEVEL_PREFIX[entry.level]} ${entry.message}`)
}

/**
 * The sweep's lines as entries, in print order. A repair line names the identity it acted on first.
 * @param {readonly string[]} lines
 * @returns {FixEntry[]}
 */
export function fixEntriesFromLines(lines) {
  return lines.map((line) => {
    const repair = Object.entries(REPAIR_PREFIX).find(([, prefix]) => line.startsWith(`${prefix} `))
    if (repair === undefined) {
      const [entry] = findingsFromLines("memory.sweep", [line])
      return { kind: "finding", .../** @type {DiagnosticFinding} */ (entry) }
    }
    const message = line.slice(repair[1].length + 1)
    return {
      kind: "repair",
      outcome: /** @type {RepairOutcome} */ (repair[0]),
      identity: message.split(" ", 1)[0] ?? "",
      message,
    }
  })
}

/** @param {readonly FixEntry[]} entries */
export function renderFixEntries(entries) {
  return entries.map((entry) =>
    entry.kind === "repair"
      ? `${REPAIR_PREFIX[entry.outcome]} ${entry.message}`
      : `${LEVEL_PREFIX[entry.level]} ${entry.message}`,
  )
}
