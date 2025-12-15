import type { AutoCompactState, FallbackState, RetryState } from "./types"
import { FALLBACK_CONFIG, RETRY_CONFIG } from "./types"

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
  }
  tui: {
    submitPrompt: (opts: { query: { directory: string } }) => Promise<unknown>
    showToast: (opts: {
      body: { title: string; message: string; variant: string; duration: number }
    }) => Promise<unknown>
  }
}

function calculateRetryDelay(attempt: number): number {
  const delay = RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffFactor, attempt - 1)
  return Math.min(delay, RETRY_CONFIG.maxDelayMs)
}

function shouldRetry(retryState: RetryState | undefined): boolean {
  if (!retryState) return true
  return retryState.attempt < RETRY_CONFIG.maxAttempts
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

async function executeRevertFallback(
  sessionID: string,
  autoCompactState: AutoCompactState,
  client: Client,
  directory: string
): Promise<boolean> {
  const fallbackState = getOrCreateFallbackState(autoCompactState, sessionID)

  if (fallbackState.revertAttempt >= FALLBACK_CONFIG.maxRevertAttempts) {
    return false
  }

  const pair = await getLastMessagePair(sessionID, client, directory)
  if (!pair) {
    return false
  }

  await client.tui
    .showToast({
      body: {
        title: "⚠️ Emergency Recovery",
        message: `Context too large. Removing last message pair to recover session...`,
        variant: "warning",
        duration: 4000,
      },
    })
    .catch(() => {})

  try {
    if (pair.assistantMessageID) {
      await client.session.revert({
        path: { id: sessionID },
        body: { messageID: pair.assistantMessageID },
        query: { directory },
      })
    }

    await client.session.revert({
      path: { id: sessionID },
      body: { messageID: pair.userMessageID },
      query: { directory },
    })

    fallbackState.revertAttempt++
    fallbackState.lastRevertedMessageID = pair.userMessageID

    const retryState = autoCompactState.retryStateBySession.get(sessionID)
    if (retryState) {
      retryState.attempt = 0
    }

    return true
  } catch {
    return false
  }
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
}

export async function executeCompact(
  sessionID: string,
  msg: Record<string, unknown>,
  autoCompactState: AutoCompactState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  directory: string
): Promise<void> {
  const retryState = getOrCreateRetryState(autoCompactState, sessionID)

  if (!shouldRetry(retryState)) {
    const fallbackState = getOrCreateFallbackState(autoCompactState, sessionID)

    if (fallbackState.revertAttempt < FALLBACK_CONFIG.maxRevertAttempts) {
      const reverted = await executeRevertFallback(
        sessionID,
        autoCompactState,
        client as Client,
        directory
      )

      if (reverted) {
        await (client as Client).tui
          .showToast({
            body: {
              title: "Recovery Attempt",
              message: "Message removed. Retrying compaction...",
              variant: "info",
              duration: 3000,
            },
          })
          .catch(() => {})

        setTimeout(() => {
          executeCompact(sessionID, msg, autoCompactState, client, directory)
        }, 1000)
        return
      }
    }

    clearSessionState(autoCompactState, sessionID)

    await (client as Client).tui
      .showToast({
        body: {
          title: "Auto Compact Failed",
          message: `Failed after ${RETRY_CONFIG.maxAttempts} retries and ${FALLBACK_CONFIG.maxRevertAttempts} message removals. Please start a new session.`,
          variant: "error",
          duration: 5000,
        },
      })
      .catch(() => {})
    return
  }

  retryState.attempt++
  retryState.lastAttemptTime = Date.now()

  try {
    const providerID = msg.providerID as string | undefined
    const modelID = msg.modelID as string | undefined

    if (providerID && modelID) {
      await (client as Client).session.summarize({
        path: { id: sessionID },
        body: { providerID, modelID },
        query: { directory },
      })

      clearSessionState(autoCompactState, sessionID)

      setTimeout(async () => {
        try {
          await (client as Client).tui.submitPrompt({ query: { directory } })
        } catch {}
      }, 500)
    }
  } catch {
    const delay = calculateRetryDelay(retryState.attempt)

    await (client as Client).tui
      .showToast({
        body: {
          title: "Auto Compact Retry",
          message: `Attempt ${retryState.attempt}/${RETRY_CONFIG.maxAttempts} failed. Retrying in ${Math.round(delay / 1000)}s...`,
          variant: "warning",
          duration: delay,
        },
      })
      .catch(() => {})

    setTimeout(() => {
      executeCompact(sessionID, msg, autoCompactState, client, directory)
    }, delay)
  }
}
