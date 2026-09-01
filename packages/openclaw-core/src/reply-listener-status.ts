import {
  isReplyListenerDaemonProcess,
  isReplyListenerProcessRunning,
} from "./reply-listener-process"
import {
  readReplyListenerPid,
  removeReplyListenerPid,
} from "./reply-listener-state"
import { sleep } from "./reply-listener-sleep"

export async function terminateReplyListenerProcess(pid: number): Promise<void> {
  if (!isReplyListenerProcessRunning(pid)) return
  if (!(await isReplyListenerDaemonProcess(pid))) return

  try {
    process.kill(pid, "SIGTERM")
  } catch (error) {
    if (error instanceof Error) return
    throw error
  }
}

export async function isDaemonRunning(): Promise<boolean> {
  const pid = readReplyListenerPid()
  if (pid === null) return false
  if (!isReplyListenerProcessRunning(pid)) {
    removeReplyListenerPid()
    return false
  }
  if (!(await isReplyListenerDaemonProcess(pid))) {
    removeReplyListenerPid()
    return false
  }
  return true
}

export async function waitForDaemonToStop(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() <= deadline) {
    if (!(await isDaemonRunning())) {
      return true
    }

    await sleep(10)
  }

  return !(await isDaemonRunning())
}

export async function waitForReplyListenerProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() <= deadline) {
    if (!isReplyListenerProcessRunning(pid)) {
      return true
    }

    await sleep(10)
  }

  return !isReplyListenerProcessRunning(pid)
}
