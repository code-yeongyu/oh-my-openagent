// Attach-or-create for a connector, in the shape of `ensureTaskDaemon`: probe the lock, attach to a
// live holder, otherwise spawn a detached connector process and wait for its readiness report.
// The child inherits a pipe on fd 3 (its number in READY_FD_ENV) and writes one line once the lock
// decision is made - `locked <pid>` when it holds the lock, `attached <pid>` when another starter
// won - then closes it. Starters that race each spawn a candidate; the lock admits exactly one, so
// every caller reports the same holder pid. Restart with backoff after a listen failure happens
// inside the holder (runConnectorHost).

import { spawn } from "node:child_process"
import { join } from "node:path"
import { Readable } from "node:stream"
import { closeSync, mkdir, openSync } from "@oh-my-opencode/memory-core/fs"
import { connectorLockPath, connectorName, connectorsDir, readConnectorLock, type LockProbe } from "./lock"

export const ENSURE_TIMEOUT_MS = 60_000
export const READY_FD_ENV = "OMO_GATEWAY_READY_FD"
const READY_FD = 3

export type EnsureConnectorInput = {
  agentDir: string
  platform: string
  account_id: string
  /** argv that runs this connector in the foreground (`omo gateway connect ... --foreground`) */
  command: readonly string[]
  env: Readonly<Record<string, string | undefined>>
  probe?: LockProbe
  timeoutMs?: number
}

export type EnsureConnectorOutcome =
  | { action: "attached"; pid: number }
  | { action: "started"; pid: number; log: string }

export class EnsureConnectorFailed extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EnsureConnectorFailed"
  }
}

export function connectorLogPath(agentDir: string, platform: string, account_id: string): string {
  return join(connectorsDir(agentDir), `${connectorName(platform, account_id)}.log`)
}

function childEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) if (value !== undefined) out[key] = value
  out[READY_FD_ENV] = String(READY_FD)
  return out
}

function parseReport(line: string): { kind: "locked" | "attached"; pid: number } | null {
  const match = /^(locked|attached) (\d+)$/.exec(line.trim())
  if (match === null) return null
  return { kind: match[1] === "locked" ? "locked" : "attached", pid: Number(match[2]) }
}

export async function ensureConnector(input: EnsureConnectorInput): Promise<EnsureConnectorOutcome> {
  const lockPath = connectorLockPath(input.agentDir, input.platform, input.account_id)
  const existing = await readConnectorLock(lockPath, input.probe)
  if (existing?.live === true) return { action: "attached", pid: existing.record.pid }

  const [program, ...args] = input.command
  if (program === undefined) throw new EnsureConnectorFailed("no connector command to spawn")
  await mkdir(connectorsDir(input.agentDir), { recursive: true, mode: 0o700 })
  const log = connectorLogPath(input.agentDir, input.platform, input.account_id)
  const logFd = openSync(log, "a", 0o600)
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(program, args, { detached: true, stdio: ["ignore", logFd, logFd, "pipe"], env: childEnv(input.env) })
  } finally {
    closeSync(logFd)
  }
  child.unref()
  const pipe = child.stdio[READY_FD]
  const ready = pipe instanceof Readable ? pipe : null
  const timeoutMs = input.timeoutMs ?? ENSURE_TIMEOUT_MS

  return await new Promise<EnsureConnectorOutcome>((resolve, reject) => {
    let settled = false
    let report = ""
    const finish = (outcome: EnsureConnectorOutcome | Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeAllListeners()
      ready?.removeAllListeners()
      ready?.destroy()
      if (outcome instanceof Error) reject(outcome)
      else resolve(outcome)
    }
    const fromReport = (): boolean => {
      const decision = parseReport(report)
      if (decision === null) return false
      finish(decision.kind === "locked" && decision.pid === child.pid ? { action: "started", pid: decision.pid, log } : { action: "attached", pid: decision.pid })
      return true
    }
    // Without a report (the child died before deciding), only a live lock holder is an answer.
    const fromLock = (reason: string) => {
      readConnectorLock(lockPath, input.probe).then(
        (holder) =>
          finish(holder?.live === true ? { action: "attached", pid: holder.record.pid } : new EnsureConnectorFailed(`${reason}; see ${log}`)),
        (error: unknown) => finish(error instanceof Error ? error : new Error(String(error))),
      )
    }
    const timer = setTimeout(() => fromLock(`no readiness report from the connector within ${timeoutMs} ms`), timeoutMs)
    child.once("error", (error) => finish(new EnsureConnectorFailed(`could not spawn the connector: ${error.message}`)))
    child.once("exit", (code, signal) => {
      if (!fromReport()) fromLock(`connector exited (${signal ?? `code ${code}`}) before reporting the lock`)
    })
    ready?.setEncoding("utf8")
    ready?.on("data", (chunk: string) => {
      report += chunk
      if (report.includes("\n")) fromReport()
    })
    ready?.once("end", () => {
      if (!fromReport()) fromLock("connector closed its readiness report without a decision")
    })
  })
}
