import type { AutoCompactState, FallbackState, RetryState, TruncateState } from "./types"
import { FALLBACK_CONFIG, RETRY_CONFIG, TRUNCATE_CONFIG } from "./types"
import { findLargestToolResult, truncateToolResult } from "./storage"

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
  autoCompactState.compactionInProgress.delete(sessionID)
}

export async function executeCompact(
  sessionID: string,
  msg: Record<string, unknown>,
  autoCompactState: AutoCompactState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  directory: string
): Promise<void> {
  if (autoCompactState.compactionInProgress.has(sessionID)) {
    return
  }
  autoCompactState.compactionInProgress.add(sessionID)

  const truncateState = getOrCreateTruncateState(autoCompactState, sessionID)

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
    }
  }

  const retryState = getOrCreateRetryState(autoCompactState, sessionID)

  if (retryState.attempt < RETRY_CONFIG.maxAttempts) {
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

        clearSessionState(autoCompactState, sessionID)

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
          executeCompact(sessionID, msg, autoCompactState, client, directory)
        }, cappedDelay)
        return
      }
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
          executeCompact(sessionID, msg, autoCompactState, client, directory)
        }, 1000)
        return
      } catch {}
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
