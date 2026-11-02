import { appendParentCrashRecord, FATAL_SIGNALS } from "../../../../../senpi-task/src/runners/rpc/crash-record"
import type { SupervisorChildExit } from "./supervisor-process-identity"

/**
 * The memory run supervisor launches its senpi child with `--supervised`, so the child writes no
 * lifetime marker and a deadline kill no longer reads as a crash (#10334). This supervisor is then
 * the process that watches the child, so it records the deaths it did not ask for, in the same
 * `process-crashes/crashes.jsonl` the engine and senpi-task's parent writer use.
 */

export type RecordMemoryChildDeathInput = {
  readonly env: NodeJS.ProcessEnv
  readonly exit: SupervisorChildExit
  /** The supervisor's own deadline was reached: any signal after it was requested. */
  readonly timedOut: boolean
  readonly startedAt: number
  readonly now: number
}

export function isUnrequestedMemoryChildDeath(exit: SupervisorChildExit, timedOut: boolean): boolean {
  return !timedOut && exit.signal !== null && FATAL_SIGNALS.has(exit.signal)
}

export function recordMemoryChildDeath(input: RecordMemoryChildDeathInput): void {
  if (!isUnrequestedMemoryChildDeath(input.exit, input.timedOut)) return
  appendParentCrashRecord(input.env, {
    at: new Date(input.now).toISOString(),
    kind: "print",
    detection: "parent",
    signal: input.exit.signal,
    uptimeMs: Math.max(0, input.now - input.startedAt),
    ...(process.versions.bun === undefined ? {} : { bunVersion: process.versions.bun }),
  })
}
