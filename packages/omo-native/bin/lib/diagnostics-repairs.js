// @ts-check
import { fixEntriesFromLines } from "./diagnostics-findings.js"
import { reflectionLockFix } from "./doctor-reflection-lock.js"
import { isEngine, isInteractive } from "./engine-processes.js"
import { listProcesses } from "./process-list.js"

/** @typedef {import("./diagnostics-contract").DiagnosticsCalls} DiagnosticsCalls */
/** @typedef {import("./diagnostics-contract").ReapedEngine} ReapedEngine */

/** @type {DiagnosticsCalls["fixReflectionLock"]} */
export async function fixReflectionLock(input = {}, ports = {}) {
  const dryRun = input.dry_run === true
  const result = await reflectionLockFix({ ...ports, dryRun })
  return { kind: "ok", value: { dry_run: dryRun, entries: fixEntriesFromLines(result.lines), failed: result.failed } }
}

/**
 * Terminates named pids and nothing else. Every refusal is deliberate: a pattern kill would reach
 * live sessions, rpc hosts and app servers, so a pid is only ever signaled when the live process
 * table still shows it as an orphaned interactive engine at the moment of the request. Each refusal
 * is decided before that pid could be signalled.
 * @type {DiagnosticsCalls["reapStaleEngines"]}
 */
export async function reapStaleEngines(input, ports = {}) {
  /** @type {readonly unknown[]} */
  const named = Array.isArray(input?.pids) ? input.pids : []
  const invalid = named.filter((pid) => !Number.isSafeInteger(pid) || /** @type {number} */ (pid) < 1)
  if (named.length === 0 || invalid.length > 0) {
    return {
      kind: "error",
      error: {
        code: "invalid_arguments",
        message: "pids must be one or more positive integers",
        next_action: "name each stale engine by its pid, as diagnostics.run lists them, then call it again",
        details: { invalid },
      },
    }
  }
  const entries = (ports.list ?? listProcesses)()
  const kill = ports.kill ?? ((pid, signal) => process.kill(pid, signal))
  /** @type {ReapedEngine[]} */
  const engines = []
  for (const pid of input.pids) {
    const entry = entries.find((candidate) => candidate.pid === pid)
    if (entry === undefined) engines.push({ pid, outcome: "not_found" })
    else if (!isEngine(entry)) engines.push({ pid, outcome: "refused", reason: "not_an_engine" })
    else if (!isInteractive(entry)) engines.push({ pid, outcome: "refused", reason: "managed_engine" })
    else if (entry.ppid !== 1)
      engines.push({ pid, outcome: "refused", reason: "live_session", details: { launcher_pid: entry.ppid } })
    else {
      try {
        kill(pid, "SIGTERM")
        engines.push({ pid, outcome: "reaped", age: entry.elapsed, tty: entry.tty })
      } catch (error) {
        engines.push({
          pid,
          outcome: "refused",
          reason: "signal_failed",
          details: { reason: error instanceof Error ? error.message : String(error) },
        })
      }
    }
  }
  if (engines.some((engine) => engine.outcome === "reaped")) return { kind: "ok", value: { engines } }
  return nothingReaped(engines)
}

/** @type {Readonly<Record<string, { code: import("./diagnostics-contract").ReapFailureCode, next_action: string }>>} */
const CAUSES = {
  not_found: { code: "not_found", next_action: "name the stale engines diagnostics.run lists, then call it again" },
  not_an_engine: { code: "not_found", next_action: "name the stale engines diagnostics.run lists, then call it again" },
  managed_engine: { code: "scope_denied", next_action: "stop a managed engine through whatever started it" },
  live_session: { code: "foreign_live_owner", next_action: "end that session through its own launcher" },
  signal_failed: {
    code: "internal_error",
    next_action: "retry; if the signal fails again, report it with the details",
  },
}

// Nothing was signalled: one shared cause answers its own code; causes that differ answer invalid_arguments, so no code
// chosen by request order speaks for the other pids. Every pid's outcome rides in details either way.
/** @param {readonly ReapedEngine[]} engines */
function nothingReaped(engines) {
  const causes = [
    ...new Set(engines.map((engine) => CAUSES[engine.outcome === "refused" ? engine.reason : engine.outcome])),
  ]
  const [only] = causes
  const cause = causes.length === 1 && only !== undefined ? only : undefined
  return {
    kind: /** @type {const} */ ("error"),
    error: {
      code: cause?.code ?? /** @type {const} */ ("invalid_arguments"),
      message: "no named pid is a stale engine that could be signalled",
      next_action:
        cause?.next_action ?? "fix the pids details.engines names, each with its own reason, then call it again",
      details: { engines },
    },
  }
}
