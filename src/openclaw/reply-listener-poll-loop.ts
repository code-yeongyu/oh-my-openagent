import { pollDiscordReplies } from "./reply-listener-discord"
import { ReplyListenerRateLimiter } from "./reply-listener-injection"
import { logReplyListenerMessage } from "./reply-listener-log"
import { sleep } from "./reply-listener-sleep"
import { getReplyListenerRuntimeSignature } from "./reply-listener-signature"
import {
  createPendingReplyListenerState,
  getReplyListenerStartupTokenFromEnv,
  markReplyListenerStopped,
  readReplyListenerDaemonConfig,
  readReplyListenerDaemonState,
  recordReplyListenerPoll,
  removeReplyListenerPid,
  writeReplyListenerDaemonState,
} from "./reply-listener-state"
import { pollTelegramReplies } from "./reply-listener-telegram"
import { pruneStale } from "./session-registry"

const PRUNE_INTERVAL_MS = 60 * 60 * 1000

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
