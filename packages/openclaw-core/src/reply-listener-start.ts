import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { normalizeReplyListenerConfig } from "./config"
import { logReplyListenerMessage } from "./reply-listener-log"
import { spawnReplyListenerDaemon } from "./reply-listener-spawn"
import { ensureReplyListenerStateDir } from "./reply-listener-paths"
import { sleep } from "./reply-listener-sleep"
import { getReplyListenerRuntimeSignature } from "./reply-listener-signature"
import {
  isDaemonRunning,
  terminateReplyListenerProcess,
  waitForDaemonToStop,
  waitForReplyListenerProcessExit,
} from "./reply-listener-status"
import {
  createPendingReplyListenerState,
  markReplyListenerStopped,
  readReplyListenerDaemonConfig,
  readReplyListenerDaemonState,
  readReplyListenerPid,
  removeReplyListenerPid,
  type ReplyListenerDaemonState,
  writeReplyListenerDaemonConfig,
  writeReplyListenerDaemonState,
  writeReplyListenerPid,
} from "./reply-listener-state"
import {
  createReplyListenerStartupToken,
  getReplyListenerStartupTimeoutMs,
  waitForReplyListenerReady,
} from "./reply-listener-startup"
import { stopReplyListener } from "./reply-listener-stop"
import { isTmuxAvailable } from "./tmux"
import type { OpenClawConfig } from "./types"

const REPLY_LISTENER_STOP_TIMEOUT_MS = 1_000

function getNormalizedReplyListenerConfig(config: OpenClawConfig): OpenClawConfig {
  return normalizeReplyListenerConfig(config)
}

function createStartFailureResult(
  message: string,
  state: ReplyListenerDaemonState,
): { success: false; message: string; started: false; state: ReplyListenerDaemonState } {
  return {
    success: false,
    message,
    started: false,
    state,
  }
}

export function resolveReplyListenerDaemonScript(currentFileUrl: string): string {
  const currentFilePath = fileURLToPath(currentFileUrl)
  return currentFilePath.endsWith(".ts")
    ? join(dirname(currentFilePath), "daemon.ts")
    : join(dirname(currentFilePath), "daemon.js")
}

export async function startReplyListener(
  config: OpenClawConfig,
): Promise<{
  success: boolean
  message: string
  started: boolean
  state?: ReplyListenerDaemonState
  error?: string
}> {
  const normalizedConfig = getNormalizedReplyListenerConfig(config)
  const replyListener = normalizedConfig.replyListener
  if (!replyListener?.discordBotToken && !replyListener?.telegramBotToken) {
    return {
      success: false,
      message: "No enabled reply listener platforms configured (missing bot tokens/channels)",
      started: false,
    }
  }

  if (await isDaemonRunning()) {
    const runningPid = readReplyListenerPid()
    const state = readReplyListenerDaemonState()
    const runtimeSignature = state?.configSignature ?? getReplyListenerRuntimeSignature(readReplyListenerDaemonConfig())
    if (runtimeSignature === getReplyListenerRuntimeSignature(normalizedConfig)) {
      return {
        success: true,
        message: "Reply listener daemon is already running",
        started: false,
        state: state || undefined,
      }
    }

    const stopResult = await stopReplyListener()
    if (!stopResult.success) {
      return {
        success: false,
        message: "Failed to restart reply listener daemon",
        started: false,
        state: stopResult.state,
        error: stopResult.error ?? stopResult.message,
      }
    }

    const stopped = runningPid === null
      ? await waitForDaemonToStop(REPLY_LISTENER_STOP_TIMEOUT_MS)
      : await waitForReplyListenerProcessExit(runningPid, REPLY_LISTENER_STOP_TIMEOUT_MS)
    if (!stopped) {
      return {
        success: false,
        message: "Timed out waiting for reply listener daemon to stop before restart",
        started: false,
        state: readReplyListenerDaemonState() || undefined,
      }
    }
  }

  if (!(await isTmuxAvailable())) {
    return {
      success: false,
      message: "tmux not available - reply injection requires tmux",
      started: false,
    }
  }

  ensureReplyListenerStateDir()
  writeReplyListenerDaemonConfig(normalizedConfig)

  const startupToken = createReplyListenerStartupToken()
  const pendingState = createPendingReplyListenerState(startupToken)
  pendingState.configSignature = getReplyListenerRuntimeSignature(normalizedConfig)
  writeReplyListenerDaemonState(pendingState)

  const daemonScript = resolveReplyListenerDaemonScript(import.meta.url)

  try {
    const processInfo = spawnReplyListenerDaemon(daemonScript, startupToken)

    processInfo.unref()

    if (!processInfo.pid) {
      const stoppedState = markReplyListenerStopped(pendingState, "Failed to start daemon process")
      writeReplyListenerDaemonState(stoppedState)
      return createStartFailureResult("Failed to start daemon process", stoppedState)
    }

    writeReplyListenerPid(processInfo.pid)

    const readyState = await waitForReplyListenerReady({
      pid: processInfo.pid,
      startupToken,
      timeoutMs: getReplyListenerStartupTimeoutMs(),
      readState: readReplyListenerDaemonState,
      sleep,
    })

    if (!readyState) {
      await terminateReplyListenerProcess(processInfo.pid)
      removeReplyListenerPid()
      const stoppedState = markReplyListenerStopped(
        readReplyListenerDaemonState() ?? pendingState,
        `Reply listener daemon did not become ready within ${getReplyListenerStartupTimeoutMs()}ms`,
      )
      writeReplyListenerDaemonState(stoppedState)
      return createStartFailureResult(
        `Reply listener daemon did not become ready within ${getReplyListenerStartupTimeoutMs()}ms`,
        stoppedState,
      )
    }

    writeReplyListenerDaemonState(readyState)
    logReplyListenerMessage(`Reply listener daemon started with PID ${processInfo.pid}`)
    return {
      success: true,
      message: `Reply listener daemon started with PID ${processInfo.pid}`,
      started: true,
      state: readyState,
    }
  } catch (error) {
    const stoppedState = markReplyListenerStopped(
      readReplyListenerDaemonState() ?? pendingState,
      error instanceof Error ? error.message : String(error),
    )
    writeReplyListenerDaemonState(stoppedState)
    removeReplyListenerPid()
    return {
      success: false,
      message: "Failed to start daemon",
      started: false,
      state: stoppedState,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
