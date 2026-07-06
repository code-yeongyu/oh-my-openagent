import type { ChildProcess } from "node:child_process"

import type { TerminateOptions } from "../types"

const DEFAULT_SIGKILL_DELAY_MS = 5_000

/**
 * THE definition of RPC child termination (single-writer rule): SIGTERM, then
 * escalate to SIGKILL after the delay if the child ignores it. This is the ONLY
 * module allowed to send process signals for an RPC child; only the lifecycle
 * destruction port (todo 12) may invoke it - never steering or manager code.
 */
export function terminateRpcChild(child: ChildProcess, options?: TerminateOptions): Promise<void> {
  const delay = options?.sigkillDelayMs ?? DEFAULT_SIGKILL_DELAY_MS
  if (hasExited(child)) {
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    let escalation: ReturnType<typeof setTimeout> | undefined
    const finish = (): void => {
      if (escalation) {
        clearTimeout(escalation)
      }
      resolve()
    }
    child.once("exit", finish)
    child.kill("SIGTERM")
    escalation = setTimeout(() => {
      if (!hasExited(child)) {
        child.kill("SIGKILL")
      }
    }, delay)
    escalation.unref?.()
  })
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}
