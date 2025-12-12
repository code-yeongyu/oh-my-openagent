import type { AutoCompactState, RetryState } from "./types"
import { RETRY_CONFIG } from "./types"

type Client = {
  session: {
    messages: (opts: { path: { id: string }; query?: { directory?: string } }) => Promise<unknown>
    summarize: (opts: {
      path: { id: string }
      body: { providerID: string; modelID: string }
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
    clearSessionState(autoCompactState, sessionID)

    await (client as Client).tui
      .showToast({
        body: {
          title: "Auto Compact Failed",
          message: `Failed after ${RETRY_CONFIG.maxAttempts} attempts. Please try manual compact.`,
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
