import type { AutoCompactState } from "./types"
import type { OhMyOpenCodeConfig } from "../../config"
import { RETRY_CONFIG } from "./types"
import type { Client } from "./client"
import {
  clearRetryTimer,
  clearSessionState,
  getEmptyContentAttempt,
  getOrCreateRetryState,
  setRetryTimer,
} from "./state"
import { sanitizeEmptyMessagesBeforeSummarize } from "./message-builder"
import { fixEmptyMessages } from "./empty-content-recovery"

import { resolveCompactionFallbackChain, resolveCompactionModel } from "../shared/compaction-model-resolver"
import { log } from "../../shared/logger"

const SUMMARIZE_RETRY_TOTAL_TIMEOUT_MS = 120_000


async function showToastSafely(
  client: Client,
  body: {
    title: string
    message: string
    variant: "error" | "warning" | "success"
    duration: number
  },
  failureContext: string,
): Promise<void> {
  try {
    await client.tui.showToast({ body })
  } catch (error) {
    log(`[auto-compact] failed to show toast: ${failureContext}`, {
      title: body.title,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function runSummarizeRetryStrategy(params: {
  sessionID: string
  msg: Record<string, unknown>
  autoCompactState: AutoCompactState
  client: Client
  directory: string
  pluginConfig: OhMyOpenCodeConfig
  errorType?: string
  messageIndex?: number
}): Promise<void> {
  if (!params.autoCompactState.pendingCompact.has(params.sessionID)) {
    clearRetryTimer(params.autoCompactState, params.sessionID)
    return
  }

  const retryState = getOrCreateRetryState(params.autoCompactState, params.sessionID)
  const now = Date.now()

  if (retryState.firstAttemptTime === 0) {
    retryState.firstAttemptTime = now
  }

  const elapsedTimeMs = now - retryState.firstAttemptTime
  if (elapsedTimeMs >= SUMMARIZE_RETRY_TOTAL_TIMEOUT_MS) {
    clearSessionState(params.autoCompactState, params.sessionID)
    await showToastSafely(
      params.client,
      {
        title: "Auto Compact Timed Out",
        message: "Compaction retries exceeded the timeout window. Please start a new session.",
        variant: "error",
        duration: 5000,
      },
      "retry timeout",
    )
    return
  }

  clearRetryTimer(params.autoCompactState, params.sessionID)

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
        const timeout = setTimeout(() => {
          params.autoCompactState.retryTimerBySession.delete(params.sessionID)
          void runSummarizeRetryStrategy(params)
        }, 500)
        setRetryTimer(params.autoCompactState, params.sessionID, timeout)
        return
      }
    } else {
      clearSessionState(params.autoCompactState, params.sessionID)
      await showToastSafely(
        params.client,
        {
          title: "Recovery Failed",
          message:
            "Max recovery attempts (3) reached for empty content error. Please start a new session.",
          variant: "error",
          duration: 10000,
        },
        "empty content recovery exhausted",
      )
      return
    }
  }

  if (Date.now() - retryState.lastAttemptTime > 300000) {
    retryState.attempt = 0
    retryState.firstAttemptTime = Date.now()
    params.autoCompactState.truncateStateBySession.delete(params.sessionID)
  }

  if (retryState.attempt < RETRY_CONFIG.maxAttempts) {
    retryState.attempt++
    retryState.lastAttemptTime = Date.now()

    const providerID = params.msg.providerID as string | undefined
    const modelID = params.msg.modelID as string | undefined

    if (providerID && modelID) {
      try {
        await sanitizeEmptyMessagesBeforeSummarize(params.sessionID, params.client)

        await showToastSafely(
          params.client,
          {
            title: "Auto Compact",
            message: `Summarizing session (attempt ${retryState.attempt}/${RETRY_CONFIG.maxAttempts})...`,
            variant: "warning",
            duration: 3000,
          },
          "summarize retry attempt",
        )

        const primary = resolveCompactionModel(
          params.pluginConfig,
          params.sessionID,
          providerID,
          modelID
        )

        // On retries beyond the first attempt, walk the compaction-scoped
        // fallback chain so the next summarize hits a different model rather
        // than re-hitting the rate-limited / failing primary. #3779 / #2062.
        const fallbackChain = resolveCompactionFallbackChain(
          params.pluginConfig,
          params.sessionID,
          primary.providerID,
        )
        const fallbackIndex = retryState.attempt - 2
        const fallbackEntry =
          fallbackChain && fallbackIndex >= 0 ? fallbackChain[fallbackIndex] : undefined
        // FallbackEntry stores `providers: string[]` (a chain of provider IDs
        // for the same logical model) and `model: string` — pick the first
        // provider as the canonical one. See packages/model-core FallbackEntry.
        const targetProviderID = fallbackEntry?.providers[0] ?? primary.providerID
        const targetModelID = fallbackEntry?.model ?? primary.modelID

        const summarizeBody = { providerID: targetProviderID, modelID: targetModelID, auto: true }
        await params.client.session.summarize({
          path: { id: params.sessionID },
          body: summarizeBody as never,
          query: { directory: params.directory },
        })
        if (fallbackEntry) {
          log("[auto-compact] summarize retry used compaction-scoped fallback model", {
            sessionID: params.sessionID,
            attempt: retryState.attempt,
            providerID: targetProviderID,
            modelID: targetModelID,
          })
        }
        clearSessionState(params.autoCompactState, params.sessionID)
        return
      } catch (error) {
        log("[auto-compact] summarize retry attempt failed", {
          sessionID: params.sessionID,
          attempt: retryState.attempt,
          error: error instanceof Error ? error.message : String(error),
        })

        const remainingTimeMs = SUMMARIZE_RETRY_TOTAL_TIMEOUT_MS - (Date.now() - retryState.firstAttemptTime)
        if (remainingTimeMs <= 0) {
          clearSessionState(params.autoCompactState, params.sessionID)
          await showToastSafely(
            params.client,
            {
              title: "Auto Compact Timed Out",
              message: "Compaction retries exceeded the timeout window. Please start a new session.",
              variant: "error",
              duration: 5000,
            },
            "summarize retry timeout after failure",
          )
          return
        }

        const delay =
          RETRY_CONFIG.initialDelayMs *
          Math.pow(RETRY_CONFIG.backoffFactor, retryState.attempt - 1)
        const cappedDelay = Math.min(delay, RETRY_CONFIG.maxDelayMs, remainingTimeMs)

        const timeout = setTimeout(() => {
          params.autoCompactState.retryTimerBySession.delete(params.sessionID)
          void runSummarizeRetryStrategy(params)
        }, cappedDelay)
        setRetryTimer(params.autoCompactState, params.sessionID, timeout)
        return
      }
    } else {
      await showToastSafely(
        params.client,
        {
          title: "Summarize Skipped",
          message: "Missing providerID or modelID.",
          variant: "warning",
          duration: 3000,
        },
        "missing summarize model info",
      )
    }
  }

  clearSessionState(params.autoCompactState, params.sessionID)
  await showToastSafely(
    params.client,
    {
      title: "Auto Compact Failed",
      message: "All recovery attempts failed. Please start a new session.",
      variant: "error",
      duration: 5000,
    },
    "summarize retry failed",
  )
}
