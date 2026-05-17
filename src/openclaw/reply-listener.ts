import { dirname, join } from "path"
import { normalizeReplyListenerConfig } from "./config"
import { pollDiscordReplies } from "./reply-listener-discord"
import { ReplyListenerRateLimiter } from "./reply-listener-injection"
import { logReplyListenerMessage } from "./reply-listener-log"
import {
  isReplyListenerDaemonProcess,
  isReplyListenerProcessRunning,
} from "./reply-listener-process"
import { spawnReplyListenerDaemon } from "./reply-listener-spawn"
import { ensureReplyListenerStateDir } from "./reply-listener-paths"
import {
  createPendingReplyListenerState,
  getReplyListenerStartupTokenFromEnv,
  markReplyListenerStopped,
  readReplyListenerDaemonConfig,
  readReplyListenerDaemonState,
  readReplyListenerPid,
  recordReplyListenerPoll,
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
import { pollTelegramReplies } from "./reply-listener-telegram"
import { pruneStale } from "./session-registry"
import { isTmuxAvailable } from "./tmux"
import type { OpenClawConfig } from "./types"

const PRUNE_INTERVAL_MS = 60 * 60 * 1000
const REPLY_LISTENER_STOP_TIMEOUT_MS = 1_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function terminateReplyListenerProcess(pid: number): Promise<void> {
  if (!isReplyListenerProcessRunning(pid)) return
  if (!(await isReplyListenerDaemonProcess(pid))) return

  try {
    process.kill(pid, "SIGTERM")
  } catch {
  }
}

function hasReplyListenerCredentials(config: OpenClawConfig): boolean {
  return Boolean(config.replyListener?.discordBotToken || config.replyListener?.telegramBotToken)
}

function getNormalizedReplyListenerConfig(config: OpenClawConfig): OpenClawConfig {
  return normalizeReplyListenerConfig(config)
}

function getReplyListenerRuntimeSignature(config: Pick<OpenClawConfig, "replyListener"> | null): string {
  return JSON.stringify(config?.replyListener ?? null)
}

async function waitForDaemonToStop(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() <= deadline) {
    if (!(await isDaemonRunning())) {
      return true
    }

    await sleep(10)
  }

  return !(await isDaemonRunning())
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

export async function pollLoop(): Promise<void> {
  logReplyListenerMessage("Reply listener daemon starting poll loop")

  const config = readReplyListenerDaemonConfig()
  if (!config) {
    logReplyListenerMessage("ERROR: No daemon config found, exiting")
    process.exit(1)
  }

  const startupToken = getReplyListenerStartupTokenFromEnv()
  const state = readReplyListenerDaemonState() ?? createPendingReplyListenerState(startupToken ?? "")
  state.configSignature = getReplyListenerRuntimeSignature(config)
  if (startupToken) {
    state.startupToken = startupToken
  }

  const rateLimiter = new ReplyListenerRateLimiter(config.replyListener?.rateLimitPerMinute || 10)
  let lastPruneAt = Date.now()

  const shutdown = (): void => {
    logReplyListenerMessage("Shutdown signal received")
    writeReplyListenerDaemonState(markReplyListenerStopped(state))
    removeReplyListenerPid()
    process.exit(0)
  }

  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)

  try {
    pruneStale()
    logReplyListenerMessage("Pruned stale registry entries")
  } catch (error) {
    logReplyListenerMessage(
      `WARN: Failed to prune stale entries: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  while (state.isRunning || state.pid === null) {
    try {
      recordReplyListenerPoll(state, process.pid)
      writeReplyListenerDaemonState(state)

      await pollDiscordReplies(config, state, rateLimiter)
      await pollTelegramReplies(config, state, rateLimiter)

      if (Date.now() - lastPruneAt > PRUNE_INTERVAL_MS) {
        try {
          pruneStale()
          lastPruneAt = Date.now()
          logReplyListenerMessage("Pruned stale registry entries")
        } catch (error) {
          logReplyListenerMessage(
            `WARN: Prune failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }

      await sleep(config.replyListener?.pollIntervalMs || 3000)
    } catch (error) {
      state.errors += 1
      state.lastError = error instanceof Error ? error.message : String(error)
      logReplyListenerMessage(`Poll error: ${state.lastError}`)
      writeReplyListenerDaemonState(state)
      await sleep((config.replyListener?.pollIntervalMs || 3000) * 2)
    }
  }

  logReplyListenerMessage("Poll loop ended")
}

function createStartFailureResult(
  message: string,
  state: ReplyListenerDaemonState,
): { success: false; message: string; state: ReplyListenerDaemonState } {
  return {
    success: false,
    message,
    state,
  }
}

export async function startReplyListener(
  config: OpenClawConfig,
): Promise<{ success: boolean; message: string; state?: ReplyListenerDaemonState; error?: string }> {
  const normalizedConfig = getNormalizedReplyListenerConfig(config)
  const replyListener = normalizedConfig.replyListener
  if (!replyListener?.discordBotToken && !replyListener?.telegramBotToken) {
    return {
      success: false,
      message: "No enabled reply listener platforms configured (missing bot tokens/channels)",
    }
  }

  if (await isDaemonRunning()) {
    const state = readReplyListenerDaemonState()
    const runtimeSignature = state?.configSignature ?? getReplyListenerRuntimeSignature(readReplyListenerDaemonConfig())
    if (runtimeSignature === getReplyListenerRuntimeSignature(normalizedConfig)) {
      return {
        success: true,
        message: "Reply listener daemon is already running",
        state: state || undefined,
      }
    }

    const stopResult = await stopReplyListener()
    if (!stopResult.success) {
      return {
        success: false,
        message: "Failed to restart reply listener daemon",
        state: stopResult.state,
        error: stopResult.error ?? stopResult.message,
      }
    }

    if (!(await waitForDaemonToStop(REPLY_LISTENER_STOP_TIMEOUT_MS))) {
      return {
        success: false,
        message: "Timed out waiting for reply listener daemon to stop before restart",
        state: readReplyListenerDaemonState() || undefined,
      }
    }
  }

  if (!(await isTmuxAvailable())) {
    return {
      success: false,
      message: "tmux not available - reply injection requires tmux",
    }
  }

  ensureReplyListenerStateDir()
  writeReplyListenerDaemonConfig(normalizedConfig)

  const startupToken = createReplyListenerStartupToken()
  const pendingState = createPendingReplyListenerState(startupToken)
  pendingState.configSignature = getReplyListenerRuntimeSignature(normalizedConfig)
  writeReplyListenerDaemonState(pendingState)

  const currentFile = import.meta.url
  const daemonScript = currentFile.endsWith(".ts")
    ? join(dirname(new URL(currentFile).pathname), "daemon.ts")
    : join(dirname(new URL(currentFile).pathname), "daemon.js")

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
      state: stoppedState,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

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

export { logReplyListenerMessage }
