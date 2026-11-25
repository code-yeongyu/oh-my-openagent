// @ts-check
import { isEngineCommand } from "./engine-commands.js"
import { finding } from "./diagnostics-findings.js"

/** @typedef {import("./diagnostics-contract").ProcessEntry} ProcessEntry */
/** @typedef {ProcessEntry & { retiredAppServer?: true }} StaleEntry */

// The interactive engine's own command line. A published install runs it as
// `<runtime> .../@code-yeongyu/senpi/dist/<entry> --extension <plugin>`; every non-interactive
// spelling carries an explicit `--mode`, and those are owned by whoever started them.
//
// Both entries have to match. The launcher prefers the engine's pre-linked bundle whenever the
// package ships one (#8417), so a current install produces `dist/bundle/cli.js` and matching only
// the unbundled spelling made the whole report blind to the sessions it exists to find.
const ENGINE_MARKERS = ["senpi/dist/cli.js", "senpi/dist/bundle/cli.js"]
export const MANAGED_MODE_FLAG = "--mode"

// A standalone binary runs its engine as the provisioned runtime executable itself. The same
// executable also serves omo's own commands, internal hosts and bundled scripts, so only a bare launch
// or engine flags count; those other roles are never engines.
const BINARY_RUNTIME_EXECUTABLE = String.raw`[\\/]binary-runtime[\\/][^\\/\s]+[\\/]omo(?:\.exe)?`
const BINARY_ENGINE = new RegExp(String.raw`${BINARY_RUNTIME_EXECUTABLE}(?=\s|$)\s*(\S*)`)
// omo's own commands; the engine's one-shot commands come from engine-commands.js (isEngineCommand).
const BINARY_NON_ENGINE_COMMANDS = new Set(["doctor", "setup", "daemon", "upgrade", "ulw-loop", "--version", "-v"])

/** @param {string} command */
function isBinaryEngine(command) {
  const match = BINARY_ENGINE.exec(command)
  if (!match) return false
  const first = match[1] ?? ""
  if (first.startsWith("--internal-") || /\.(?:m?js|cjs|ts)$/.test(first)) return false
  // A one-shot command omo hands to the engine unchanged runs to completion and is never a session (#14336).
  const args = command.slice(match.index + match[0].length - first.length).split(/\s+/)
  return !BINARY_NON_ENGINE_COMMANDS.has(first) && !isEngineCommand(args)
}

/** @param {ProcessEntry} entry */
export function isEngine(entry) {
  return ENGINE_MARKERS.some((marker) => entry.command.includes(marker)) || isBinaryEngine(entry.command)
}

// A daemon started by an older engine as `... app-server` keeps running after an upgrade. It has no
// `--mode` and is reparented to init, so it would otherwise read as an orphaned session.
const RETIRED_APP_SERVER = new RegExp(
  String.raw`(?:senpi[\\/]dist[\\/](?:bundle[\\/])?cli\.js|${BINARY_RUNTIME_EXECUTABLE})\s+app-server(?=\s|$)`,
)

/** @param {ProcessEntry} entry */
function isRetiredAppServer(entry) {
  return RETIRED_APP_SERVER.test(entry.command)
}

/** @param {ProcessEntry} entry */
export function isInteractive(entry) {
  return !entry.command.includes(MANAGED_MODE_FLAG)
}

/**
 * Splits every engine process this machine is running into the three groups that matter:
 *   - stale:   interactive engines reparented to init, i.e. their launcher died underneath them
 *   - attached: interactive engines still owned by a live parent (somebody's session)
 *   - managed:  `--mode` engines such as rpc, which are owned by whatever embeds them
 * Only the first group is ever reportable, and even then only as a report.
 * @param {readonly ProcessEntry[]} entries
 */
export function classifyEngineProcesses(entries) {
  /** @type {StaleEntry[]} */
  const stale = []
  /** @type {ProcessEntry[]} */
  const attached = []
  /** @type {ProcessEntry[]} */
  const managed = []
  for (const entry of entries) {
    if (!isEngine(entry)) continue
    if (!isInteractive(entry)) managed.push(entry)
    else if (entry.ppid === 1) stale.push(isRetiredAppServer(entry) ? { ...entry, retiredAppServer: true } : entry)
    else attached.push(entry)
  }
  return { stale, attached, managed }
}

/** @param {readonly StaleEntry[]} stale */
export function staleEngineFindings(stale) {
  if (stale.length === 0) return []
  const findings = stale.map((entry) =>
    finding(
      "engines.stale",
      "warn",
      entry.retiredAppServer
        ? `stale engine pid ${entry.pid} (age ${entry.elapsed}, tty ${entry.tty}) is an app-server daemon started by an older version; that command was removed, so stop it`
        : `stale engine pid ${entry.pid} (age ${entry.elapsed}, tty ${entry.tty}) has no launcher; it was orphaned by a signaled launcher`,
      { pid: entry.pid, age: entry.elapsed, tty: entry.tty, retired_app_server: entry.retiredAppServer === true },
    ),
  )
  const pids = stale.map((entry) => entry.pid)
  findings.push(
    finding("engines.stale", "notice", `reap them explicitly by pid: omo doctor --reap ${pids.join(" ")}`, { pids }),
  )
  return findings
}

// ps `etime` is the portable start-time signal on macOS and Linux alike; an unparsable value must
// leave the process unclassified rather than fail a diagnostic.
/** @param {string} elapsed */
export function parseElapsedSeconds(elapsed) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(elapsed)
  if (!match) return undefined
  return Number(match[1] ?? 0) * 86_400 + Number(match[2] ?? 0) * 3_600 + Number(match[3]) * 60 + Number(match[4])
}

/** @param {string} command */
function payloadDirFromCommand(command) {
  return /--extension\s+(\S+)/.exec(command)?.[1]
}

/**
 * An engine that started before ITS OWN payload was last written is executing a retired copy of it:
 * the bundle is loaded once per process while its skills and persona assets are read from that tree
 * later, so an in-place upgrade leaves the process reaching for files the tree no longer has. Each
 * engine is compared against the payload named on its own command line, because one machine runs
 * several (a global install, a compiled runtime dir, a dev staging tree) and only the one a process
 * actually loads can retire under it. Restarting the session is the only repair and it belongs to
 * whoever owns the session - nothing here may signal such a process.
 * @param {readonly ProcessEntry[]} entries
 * @param {{ payloadMtimeMs: (payloadDir: string) => number | undefined, nowMs: number }} input
 */
export function classifyRetiredPayloadEngines(entries, input) {
  /** @type {ProcessEntry[]} */
  const retired = []
  for (const entry of entries) {
    if (!isEngine(entry)) continue
    const elapsedSeconds = parseElapsedSeconds(entry.elapsed)
    if (elapsedSeconds === undefined) continue
    const payloadDir = payloadDirFromCommand(entry.command)
    if (payloadDir === undefined) continue
    const payloadMtimeMs = input.payloadMtimeMs(payloadDir)
    if (payloadMtimeMs === undefined) continue
    if (input.nowMs - elapsedSeconds * 1_000 < payloadMtimeMs) retired.push(entry)
  }
  return retired
}

/** @param {readonly ProcessEntry[]} retired */
export function retiredPayloadFindings(retired) {
  if (retired.length === 0) return []
  const findings = retired.map((entry) =>
    finding(
      "engines.retired-payload",
      "warn",
      `engine pid ${entry.pid} (age ${entry.elapsed}, tty ${entry.tty}) started before this payload was installed; it still runs the previous plugin copy`,
      { pid: entry.pid, age: entry.elapsed, tty: entry.tty },
    ),
  )
  findings.push(
    finding(
      "engines.retired-payload",
      "notice",
      "restart those sessions to pick up the installed payload; a running engine is never rewritten in place",
    ),
  )
  return findings
}
