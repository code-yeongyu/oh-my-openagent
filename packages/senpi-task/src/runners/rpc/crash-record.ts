import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { ChildExitOutcome } from "../types"

/**
 * A process-mode task child runs in RPC mode, which writes no lifetime marker of its own (senpi#2194):
 * this parent is the process that watches it, so this parent records its death. The record lands in
 * the same `<agentDir>/process-crashes/crashes.jsonl` senpi writes, in the same shape, so one reporter
 * reads every kind (oh-my-openagent#8931).
 */

/** Signals that mean the child died, as opposed to being asked to stop by a terminal or supervisor. */
const FATAL_SIGNALS: ReadonlySet<string> = new Set([
  "SIGSEGV", "SIGBUS", "SIGILL", "SIGTRAP", "SIGABRT", "SIGFPE", "SIGKILL", "SIGSYS", "SIGQUIT",
])
/** Exit codes senpi's own SIGHUP / SIGINT / SIGTERM handlers finish with: a stop, not a crash. */
const SIGNAL_SHUTDOWN_CODES: ReadonlySet<number> = new Set([129, 130, 143])
const RECORD_LIMIT = 50

export type RecordTaskChildDeathInput = {
  readonly env: NodeJS.ProcessEnv
  readonly outcome: ChildExitOutcome
  readonly terminationRequested: boolean
  readonly startedAt: number
  readonly now: number
}

export function isUnexpectedChildDeath(outcome: ChildExitOutcome, terminationRequested: boolean): boolean {
  if (terminationRequested) return false
  const { code, signal } = outcome.facts
  if (outcome.kind === "killed") return signal !== null && FATAL_SIGNALS.has(signal)
  if (outcome.kind === "crashed") return code !== null && !SIGNAL_SHUTDOWN_CODES.has(code)
  return false
}

export function recordTaskChildDeath(input: RecordTaskChildDeathInput): void {
  if (!isUnexpectedChildDeath(input.outcome, input.terminationRequested)) return
  const agentDir = input.env.OMO_CODING_AGENT_DIR ?? input.env.SENPI_CODING_AGENT_DIR ?? input.env.PI_CODING_AGENT_DIR
  if (agentDir === undefined || agentDir.length === 0) return
  const { code, signal } = input.outcome.facts
  const record = {
    at: new Date(input.now).toISOString(),
    kind: "task-child",
    detection: "parent",
    ...(signal === null ? { code: code ?? undefined } : { signal }),
    uptimeMs: Math.max(0, input.now - input.startedAt),
    ...(process.versions.bun === undefined ? {} : { bunVersion: process.versions.bun }),
  }
  try {
    const dir = join(agentDir, "process-crashes")
    const file = join(dir, "crashes.jsonl")
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 })
    const lines = readFileSync(file, "utf8").split("\n").filter((line) => line.trim() !== "")
    if (lines.length > RECORD_LIMIT) writeFileSync(file, `${lines.slice(-RECORD_LIMIT).join("\n")}\n`, { mode: 0o600 })
  } catch {}
}
