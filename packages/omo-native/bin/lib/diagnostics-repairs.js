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
  return { kind: "ok", value: { engines } }
}
