import { logReplyListenerMessage } from "./reply-listener-log"
import {
  isReplyListenerDaemonProcess,
  isReplyListenerProcessRunning,
} from "./reply-listener-process"
import {
  markReplyListenerStopped,
  readReplyListenerDaemonState,
  readReplyListenerPid,
  removeReplyListenerPid,
  type ReplyListenerDaemonState,
  writeReplyListenerDaemonState,
} from "./reply-listener-state"

export async function stopReplyListener(): Promise<{
  success: boolean
  message: string
  state?: ReplyListenerDaemonState
  error?: string
}> {
  const pid = readReplyListenerPid()
  if (pid === null) {
    return {
      success: true,
      message: "Reply listener daemon is not running",
    }
  }

  if (!isReplyListenerProcessRunning(pid)) {
    removeReplyListenerPid()
    return {
      success: true,
      message: "Reply listener daemon was not running (cleaned up stale PID file)",
    }
  }

  if (!(await isReplyListenerDaemonProcess(pid))) {
    removeReplyListenerPid()
    return {
      success: false,
      message: `Refusing to kill PID ${pid}: process identity does not match the reply listener daemon (stale or reused PID - removed PID file)`,
    }
  }

  try {
    process.kill(pid, "SIGTERM")
    removeReplyListenerPid()
    const state = markReplyListenerStopped(readReplyListenerDaemonState())
    writeReplyListenerDaemonState(state)
    logReplyListenerMessage(`Reply listener daemon stopped (PID ${pid})`)
    return {
      success: true,
      message: `Reply listener daemon stopped (PID ${pid})`,
      state,
    }
  } catch (error) {
    return {
      success: false,
      message: "Failed to stop daemon",
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
