import type { AutoCompactState, FallbackState, RetryState, TruncateState } from "./types"
import type { ExperimentalConfig } from "../../config"
import { FALLBACK_CONFIG, RETRY_CONFIG, TRUNCATE_CONFIG } from "./types"
import { findLargestToolResult, truncateToolResult, truncateUntilTargetTokens } from "./storage"
import { findEmptyMessages, injectTextPart } from "../session-recovery/storage"
import { log } from "../../shared/logger"

type Client = {
  session: {
    messages: (opts: { path: { id: string }; query?: { directory?: string } }) => Promise<unknown>
    summarize: (opts: {
      path: { id: string }
      body: { providerID: string; modelID: string }
      query: { directory: string }
    }) => Promise<unknown>
    revert: (opts: {
      path: { id: string }
      body: { messageID: string; partID?: string }
      query: { directory: string }
    }) => Promise<unknown>
    prompt_async: (opts: {
      path: { sessionID: string }
      body: { parts: Array<{ type: string; text: string }> }
      query: { directory: string }
    }) => Promise<unknown>
  }
  tui: {
    showToast: (opts: {
      body: { title: string; message: string; variant: string; duration: number }
    }) => Promise<unknown>
  }
}

function getOrCreateRetryState(
  autoCompactState: AutoCompactState,
  sessionID: string
): RetryState {
  let state = autoCompactState.retryStateBySession.get(sessionID)
  if (!state) {
    state = { attempt: 0, lastAttemptTime: 0 }
    autoCompactState.retryStateBySession.set(sessionID, state)
  }
  return state
}

function getOrCreateFallbackState(
  autoCompactState: AutoCompactState,
  sessionID: string
): FallbackState {
  let state = autoCompactState.fallbackStateBySession.get(sessionID)
  if (!state) {
    state = { revertAttempt: 0 }
    autoCompactState.fallbackStateBySession.set(sessionID, state)
  }
  return state
}

function getOrCreateTruncateState(
  autoCompactState: AutoCompactState,
  sessionID: string
): TruncateState {
  let state = autoCompactState.truncateStateBySession.get(sessionID)
  if (!state) {
    state = { truncateAttempt: 0 }
    autoCompactState.truncateStateBySession.set(sessionID, state)
  }
  return state
}

async function getLastMessagePair(
  sessionID: string,
  client: Client,
  directory: string
): Promise<{ userMessageID: string; assistantMessageID?: string } | null> {
  try {
    const resp = await client.session.messages({
      path: { id: sessionID },
      query: { directory },
    })

    const data = (resp as { data?: unknown[] }).data
    if (!Array.isArray(data) || data.length < FALLBACK_CONFIG.minMessagesRequired) {
      return null
    }

    const reversed = [...data].reverse()

    const lastAssistant = reversed.find((m) => {
      const msg = m as Record<string, unknown>
      const info = msg.info as Record<string, unknown> | undefined
      return info?.role === "assistant"
    })

    const lastUser = reversed.find((m) => {
      const msg = m as Record<string, unknown>
      const info = msg.info as Record<string, unknown> | undefined
      return info?.role === "user"
    })

    if (!lastUser) return null
    const userInfo = (lastUser as { info?: Record<string, unknown> }).info
    const userMessageID = userInfo?.id as string | undefined
    if (!userMessageID) return null

    let assistantMessageID: string | undefined
    if (lastAssistant) {
      const assistantInfo = (lastAssistant as { info?: Record<string, unknown> }).info
      assistantMessageID = assistantInfo?.id as string | undefined
    }

    return { userMessageID, assistantMessageID }
  } catch {
    return null
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export async function getLastAssistant(
  sessionID: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  directory: string
): Promise<Record<string, unknown> | null> {
  try {
    const resp = await (client as Client).session.messages({
      path: { id: sessionID },
      query: { directory },
    })

    const data = (resp as { data?: unknown[] }).data
    if (!Array.isArray(data)) return null

    const reversed = [...data].reverse()
    const last = reversed.find((m) => {
      const msg = m as Record<string, unknown>
      const info = msg.info as Record<string, unknown> | undefined
      return info?.role === "assistant"
    })
    if (!last) return null
    return (last as { info?: Record<string, unknown> }).info ?? null
  } catch {
    return null
  }
}

function clearSessionState(autoCompactState: AutoCompactState, sessionID: string): void {
  autoCompactState.pendingCompact.delete(sessionID)
  autoCompactState.errorDataBySession.delete(sessionID)
  autoCompactState.retryStateBySession.delete(sessionID)
  autoCompactState.fallbackStateBySession.delete(sessionID)
  autoCompactState.truncateStateBySession.delete(sessionID)
  autoCompactState.emptyContentAttemptBySession.delete(sessionID)
  autoCompactState.compactionInProgress.delete(sessionID)
}

function getOrCreateEmptyContentAttempt(
  autoCompactState: AutoCompactState,
  sessionID: string
): number {
  return autoCompactState.emptyContentAttemptBySession.get(sessionID) ?? 0
}

async function fixEmptyMessages(
  sessionID: string,
  autoCompactState: AutoCompactState,
  client: Client
): Promise<boolean> {
  const attempt = getOrCreateEmptyContentAttempt(autoCompactState, sessionID)
  autoCompactState.emptyContentAttemptBySession.set(sessionID, attempt + 1)

  const emptyMessageIds = findEmptyMessages(sessionID)
  if (emptyMessageIds.length === 0) {
    await client.tui
      .showToast({
        body: {
          title: "Empty Content Error",
          message: "No empty messages found in storage. Cannot auto-recover.",
          variant: "error",
          duration: 5000,
        },
      })
      .catch(() => {})
    return false
  }

  let fixed = false
  for (const messageID of emptyMessageIds) {
    const success = injectTextPart(sessionID, messageID, "[user interrupted]")
    if (success) fixed = true
  }

  if (fixed) {
    await client.tui
      .showToast({
        body: {
          title: "Session Recovery",
          message: `Fixed ${emptyMessageIds.length} empty messages. Retrying...`,
          variant: "warning",
          duration: 3000,
        },
      })
      .catch(() => {})
  }

  return fixed
}

export async function executeCompact(
  sessionID: string,
  msg: Record<string, unknown>,
  autoCompactState: AutoCompactState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  directory: string,
  experimental?: ExperimentalConfig
): Promise<void> {
  if (autoCompactState.compactionInProgress.has(sessionID)) {
    return
  }
  autoCompactState.compactionInProgress.add(sessionID)

  const errorData = autoCompactState.errorDataBySession.get(sessionID)
  const truncateState = getOrCreateTruncateState(autoCompactState, sessionID)

  if (
    experimental?.aggressive_truncation &&
    errorData?.currentTokens &&
    errorData?.maxTokens &&
    errorData.currentTokens > errorData.maxTokens &&
    truncateState.truncateAttempt < TRUNCATE_CONFIG.maxTruncateAttempts
  ) {
    log("[auto-compact] aggressive truncation triggered (experimental)", {
      currentTokens: errorData.currentTokens,
      maxTokens: errorData.maxTokens,
      targetRatio: TRUNCATE_CONFIG.targetTokenRatio,
    })

    const aggressiveResult = truncateUntilTargetTokens(
      sessionID,
      errorData.currentTokens,
      errorData.maxTokens,
      TRUNCATE_CONFIG.targetTokenRatio,
      TRUNCATE_CONFIG.charsPerToken
    )

    if (aggressiveResult.truncatedCount > 0) {
      truncateState.truncateAttempt += aggressiveResult.truncatedCount

      const toolNames = aggressiveResult.truncatedTools.map((t) => t.toolName).join(", ")
      const statusMsg = aggressiveResult.sufficient
        ? `Truncated ${aggressiveResult.truncatedCount} outputs (${formatBytes(aggressiveResult.totalBytesRemoved)})`
        : `Truncated ${aggressiveResult.truncatedCount} outputs (${formatBytes(aggressiveResult.totalBytesRemoved)}) but need ${formatBytes(aggressiveResult.targetBytesToRemove)}. Falling back to summarize/revert...`

      await (client as Client).tui
        .showToast({
          body: {
            title: aggressiveResult.sufficient ? "Aggressive Truncation" : "Partial Truncation",
            message: `${statusMsg}: ${toolNames}`,
            variant: "warning",
            duration: 4000,
          },
        })
        .catch(() => {})

      log("[auto-compact] aggressive truncation completed", aggressiveResult)

      if (aggressiveResult.sufficient) {
        autoCompactState.compactionInProgress.delete(sessionID)

        setTimeout(async () => {
          try {
            await (client as Client).session.prompt_async({
              path: { sessionID },
              body: { parts: [{ type: "text", text: "Continue" }] },
              query: { directory },
            })
          } catch {}
        }, 500)
        return
      }
    } else {
      await (client as Client).tui
        .showToast({
          body: {
            title: "Truncation Skipped",
            message: "No tool outputs found to truncate.",
            variant: "warning",
            duration: 3000,
          },
        })
        .catch(() => {})
    }
  }

  let skipSummarize = false

  if (truncateState.truncateAttempt < TRUNCATE_CONFIG.maxTruncateAttempts) {
    const largest = findLargestToolResult(sessionID)

    if (largest && largest.outputSize >= TRUNCATE_CONFIG.minOutputSizeToTruncate) {
      const result = truncateToolResult(largest.partPath)

      if (result.success) {
        truncateState.truncateAttempt++
        truncateState.lastTruncatedPartId = largest.partId

        await (client as Client).tui
          .showToast({
            body: {
              title: "Truncating Large Output",
              message: `Truncated ${result.toolName} (${formatBytes(result.originalSize ?? 0)}). Retrying...`,
              variant: "warning",
              duration: 3000,
            },
          })
          .catch(() => {})

        autoCompactState.compactionInProgress.delete(sessionID)

        setTimeout(async () => {
          try {
            await (client as Client).session.prompt_async({
              path: { sessionID },
              body: { parts: [{ type: "text", text: "Continue" }] },
              query: { directory },
            })
          } catch {}
        }, 500)
        return
      }
    } else if (errorData?.currentTokens && errorData?.maxTokens && errorData.currentTokens > errorData.maxTokens) {
      skipSummarize = true
      await (client as Client).tui
        .showToast({
          body: {
            title: "Summarize Skipped",
            message: `Over token limit (${errorData.currentTokens}/${errorData.maxTokens}) with nothing to truncate. Going to revert...`,
            variant: "warning",
            duration: 3000,
          },
        })
        .catch(() => {})
    } else if (!errorData?.currentTokens) {
      await (client as Client).tui
        .showToast({
          body: {
            title: "Truncation Skipped",
            message: "No large tool outputs found.",
            variant: "warning",
            duration: 3000,
          },
        })
        .catch(() => {})
    }
  }

  const retryState = getOrCreateRetryState(autoCompactState, sessionID)

  if (experimental?.empty_message_recovery && errorData?.errorType?.includes("non-empty content")) {
    const attempt = getOrCreateEmptyContentAttempt(autoCompactState, sessionID)
    if (attempt < 3) {
      const fixed = await fixEmptyMessages(sessionID, autoCompactState, client as Client)
      if (fixed) {
        autoCompactState.compactionInProgress.delete(sessionID)
        setTimeout(() => {
          executeCompact(sessionID, msg, autoCompactState, client, directory, experimental)
        }, 500)
        return
      }
    } else {
      await (client as Client).tui
        .showToast({
          body: {
            title: "Recovery Failed",
            message: "Max recovery attempts (3) reached for empty content error. Please start a new session.",
            variant: "error",
            duration: 10000,
          },
        })
        .catch(() => {})
      autoCompactState.compactionInProgress.delete(sessionID)
      return
    }
  }

  if (Date.now() - retryState.lastAttemptTime > 300000) {
    retryState.attempt = 0
    autoCompactState.fallbackStateBySession.delete(sessionID)
    autoCompactState.truncateStateBySession.delete(sessionID)
  }

  if (!skipSummarize && retryState.attempt < RETRY_CONFIG.maxAttempts) {
    retryState.attempt++
    retryState.lastAttemptTime = Date.now()

    const providerID = msg.providerID as string | undefined
    const modelID = msg.modelID as string | undefined

    if (providerID && modelID) {
      try {
        await (client as Client).tui
          .showToast({
            body: {
              title: "Auto Compact",
              message: `Summarizing session (attempt ${retryState.attempt}/${RETRY_CONFIG.maxAttempts})...`,
              variant: "warning",
              duration: 3000,
            },
          })
          .catch(() => {})

        await (client as Client).session.summarize({
          path: { id: sessionID },
          body: { providerID, modelID },
          query: { directory },
        })

        autoCompactState.compactionInProgress.delete(sessionID)

        setTimeout(async () => {
          try {
            await (client as Client).session.prompt_async({
              path: { sessionID },
              body: { parts: [{ type: "text", text: "Continue" }] },
              query: { directory },
            })
          } catch {}
        }, 500)
        return
      } catch {
        autoCompactState.compactionInProgress.delete(sessionID)

        const delay = RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffFactor, retryState.attempt - 1)
        const cappedDelay = Math.min(delay, RETRY_CONFIG.maxDelayMs)

        setTimeout(() => {
          executeCompact(sessionID, msg, autoCompactState, client, directory, experimental)
        }, cappedDelay)
        return
      }
    } else {
      await (client as Client).tui
        .showToast({
          body: {
            title: "Summarize Skipped",
            message: "Missing providerID or modelID. Skipping to revert...",
            variant: "warning",
            duration: 3000,
          },
        })
        .catch(() => {})
    }
  }

  const fallbackState = getOrCreateFallbackState(autoCompactState, sessionID)

  if (fallbackState.revertAttempt < FALLBACK_CONFIG.maxRevertAttempts) {
    const pair = await getLastMessagePair(sessionID, client as Client, directory)

    if (pair) {
      try {
        await (client as Client).tui
          .showToast({
            body: {
              title: "Emergency Recovery",
              message: "Removing last message pair...",
              variant: "warning",
              duration: 3000,
            },
          })
          .catch(() => {})

        if (pair.assistantMessageID) {
          await (client as Client).session.revert({
            path: { id: sessionID },
            body: { messageID: pair.assistantMessageID },
            query: { directory },
          })
        }

        await (client as Client).session.revert({
          path: { id: sessionID },
          body: { messageID: pair.userMessageID },
          query: { directory },
        })

        fallbackState.revertAttempt++
        fallbackState.lastRevertedMessageID = pair.userMessageID

        retryState.attempt = 0
        truncateState.truncateAttempt = 0

        autoCompactState.compactionInProgress.delete(sessionID)

        setTimeout(() => {
          executeCompact(sessionID, msg, autoCompactState, client, directory, experimental)
        }, 1000)
        return
      } catch {}
    } else {
      await (client as Client).tui
        .showToast({
          body: {
            title: "Revert Skipped",
            message: "Could not find last message pair to revert.",
            variant: "warning",
            duration: 3000,
          },
        })
        .catch(() => {})
    }
  }

  clearSessionState(autoCompactState, sessionID)

  await (client as Client).tui
    .showToast({
      body: {
        title: "Auto Compact Failed",
        message: "All recovery attempts failed. Please start a new session.",
        variant: "error",
        duration: 5000,
      },
    })
    .catch(() => {})
}
