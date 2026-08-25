import { type ChildProcess, spawn } from "node:child_process"

import type { TerminateOptions } from "../types"

const DEFAULT_SIGKILL_DELAY_MS = 5_000

/**
 * THE definition of RPC child termination (single-writer rule): terminate the
 * owned process tree, escalating after the delay on POSIX. This is the ONLY
 * module allowed to send process signals for an RPC child.
 */
export async function terminateRpcChild(child: ChildProcess, options?: TerminateOptions): Promise<void> {
  const pid = child.pid
  if (pid === undefined) {
    return
  }
  if (process.platform === "win32") {
    await terminateWindowsProcessTree(child, pid)
    return
  }
  await terminatePosixProcessGroup(child, pid, options?.sigkillDelayMs ?? DEFAULT_SIGKILL_DELAY_MS)
}

async function terminatePosixProcessGroup(child: ChildProcess, pid: number, delay: number): Promise<void> {
  if (!processGroupExists(pid)) {
    await terminateDirectChild(child, delay)
    return
  }
  const exited = childExit(child)
  signalProcessGroup(pid, "SIGTERM")
  await waitForExitOrDelay(exited, delay)
  if (processGroupExists(pid)) {
    signalProcessGroup(pid, "SIGKILL")
  }
  await exited
}

async function terminateDirectChild(child: ChildProcess, delay: number): Promise<void> {
  if (hasExited(child)) {
    return
  }
  const exited = childExit(child)
  child.kill("SIGTERM")
  await waitForExitOrDelay(exited, delay)
  if (!hasExited(child)) {
    child.kill("SIGKILL")
  }
  await exited
}

async function waitForExitOrDelay(exited: Promise<void>, delay: number): Promise<void> {
  let escalation: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    exited,
    new Promise<void>((resolve) => {
      escalation = setTimeout(resolve, delay)
      escalation.unref?.()
    }),
  ])
  if (escalation) {
    clearTimeout(escalation)
  }
}

async function terminateWindowsProcessTree(child: ChildProcess, pid: number): Promise<void> {
  if (hasExited(child)) {
    return
  }
  const exited = childExit(child)
  const taskkill = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  })
  await new Promise<void>((resolve, reject) => {
    taskkill.once("error", reject)
    taskkill.once("close", () => resolve())
  })
  if (!hasExited(child)) {
    child.kill("SIGKILL")
  }
  await exited
}

function childExit(child: ChildProcess): Promise<void> {
  if (hasExited(child)) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    child.once("exit", () => resolve())
  })
}

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return !isNoSuchProcess(error)
  }
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if (!isNoSuchProcess(error)) {
      throw error
    }
  }
}

function isNoSuchProcess(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ESRCH"
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}
