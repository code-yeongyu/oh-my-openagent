import type { AutoCompactState } from "./types"
import { RETRY_CONFIG } from "./types"
import type { Client } from "./client"
import { clearSessionState, getEmptyContentAttempt, getOrCreateRetryState } from "./state"
import { sanitizeEmptyMessagesBeforeSummarize } from "./message-builder"
import { fixEmptyMessages } from "./empty-content-recovery"

export async function runSummarizeRetryStrategy(params: {
  sessionID: string
  msg: Record<string, unknown>
  autoCompactState: AutoCompactState
  client: Client
  directory: string
  errorType?: string
  messageIndex?: number
}): Promise<void> {
  const retryState = getOrCreateRetryState(params.autoCompactState, params.sessionID)

  if (params.errorType?.includes("non-empty content")) {
    const attempt = getEmptyContentAttempt(params.autoCompactState, params.sessionID)
    if (attempt < 3) {
      const fixed = await fixEmptyMessages({
        sessionID: params.sessionID,
        autoCompactState: params.autoCompactState,
        client: params.client,
        messageIndex: params.messageIndex,
      })
      if (fixed) {
        setTimeout(() => {
          void runSummarizeRetryStrategy(params)
        }, 500)
        return
      }
    } else {
      await params.client.tui
        .showToast({
          body: {
            title: "Recovery Failed",
            message:
              "Max recovery attempts (3) reached for empty content error. Please start a new session.",
            variant: "error",
            duration: 10000,
          },
        })
        .catch(() => {})
      return
    }
  }

  if (Date.now() - retryState.lastAttemptTime > 300000) {
    retryState.attempt = 0
    params.autoCompactState.truncateStateBySession.delete(params.sessionID)
  }

  if (retryState.attempt < RETRY_CONFIG.maxAttempts) {
    retryState.attempt++
    retryState.lastAttemptTime = Date.now()

    const providerID = params.msg.providerID as string | undefined
    const modelID = params.msg.modelID as string | undefined

    if (providerID && modelID) {
      try {
        sanitizeEmptyMessagesBeforeSummarize(params.sessionID)

        await params.client.tui
          .showToast({
            body: {
              title: "Auto Compact",
              message: `Summarizing session (attempt ${retryState.attempt}/${RETRY_CONFIG.maxAttempts})...`,
              variant: "warning",
              duration: 3000,
            },
          })
          .catch(() => {})

        const summarizeBody = { providerID, modelID, auto: true }
        await params.client.session.summarize({
          path: { id: params.sessionID },
          body: summarizeBody as never,
          query: { directory: params.directory },
        })
        return
      } catch {
        const delay =
          RETRY_CONFIG.initialDelayMs *
          Math.pow(RETRY_CONFIG.backoffFactor, retryState.attempt - 1)
        const cappedDelay = Math.min(delay, RETRY_CONFIG.maxDelayMs)

        setTimeout(() => {
          void runSummarizeRetryStrategy(params)
        }, cappedDelay)
        return
      }
    } else {
      await params.client.tui
        .showToast({
          body: {
            title: "Summarize Skipped",
            message: "Missing providerID or modelID.",
            variant: "warning",
            duration: 3000,
          },
        })
        .catch(() => {})
    }
  }

  clearSessionState(params.autoCompactState, params.sessionID)
  await params.client.tui
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
