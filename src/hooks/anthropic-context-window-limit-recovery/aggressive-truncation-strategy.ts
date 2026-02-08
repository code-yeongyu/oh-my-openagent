import type { AutoCompactState } from "./types"
import { TRUNCATE_CONFIG } from "./types"
import { truncateUntilTargetTokens } from "./storage"
import type { Client } from "./client"
import { clearSessionState } from "./state"
import { formatBytes } from "./message-builder"
import { log } from "../../shared/logger"

export async function runAggressiveTruncationStrategy(params: {
  sessionID: string
  autoCompactState: AutoCompactState
  client: Client
  directory: string
  truncateAttempt: number
  currentTokens: number
  maxTokens: number
}): Promise<{ handled: boolean; nextTruncateAttempt: number }> {
  if (params.truncateAttempt >= TRUNCATE_CONFIG.maxTruncateAttempts) {
    return { handled: false, nextTruncateAttempt: params.truncateAttempt }
  }

  log("[auto-compact] PHASE 2: aggressive truncation triggered", {
    currentTokens: params.currentTokens,
    maxTokens: params.maxTokens,
    targetRatio: TRUNCATE_CONFIG.targetTokenRatio,
  })

  const aggressiveResult = truncateUntilTargetTokens(
    params.sessionID,
    params.currentTokens,
    params.maxTokens,
    TRUNCATE_CONFIG.targetTokenRatio,
    TRUNCATE_CONFIG.charsPerToken,
  )

  if (aggressiveResult.truncatedCount <= 0) {
    return { handled: false, nextTruncateAttempt: params.truncateAttempt }
  }

  const nextTruncateAttempt = params.truncateAttempt + aggressiveResult.truncatedCount
  const toolNames = aggressiveResult.truncatedTools.map((t) => t.toolName).join(", ")
  const statusMsg = aggressiveResult.sufficient
    ? `Truncated ${aggressiveResult.truncatedCount} outputs (${formatBytes(aggressiveResult.totalBytesRemoved)})`
    : `Truncated ${aggressiveResult.truncatedCount} outputs (${formatBytes(aggressiveResult.totalBytesRemoved)}) - continuing to summarize...`

  await params.client.tui
    .showToast({
      body: {
        title: aggressiveResult.sufficient ? "Truncation Complete" : "Partial Truncation",
        message: `${statusMsg}: ${toolNames}`,
        variant: aggressiveResult.sufficient ? "success" : "warning",
        duration: 4000,
      },
    })
    .catch(() => {})

  log("[auto-compact] aggressive truncation completed", aggressiveResult)

  if (aggressiveResult.sufficient) {
    clearSessionState(params.autoCompactState, params.sessionID)
    setTimeout(async () => {
      try {
        await params.client.session.prompt_async({
          path: { id: params.sessionID },
          body: { auto: true } as never,
          query: { directory: params.directory },
        })
      } catch {}
    }, 500)

    return { handled: true, nextTruncateAttempt }
  }

  log("[auto-compact] truncation insufficient, falling through to summarize", {
    sessionID: params.sessionID,
    truncatedCount: aggressiveResult.truncatedCount,
    sufficient: aggressiveResult.sufficient,
  })

  return { handled: false, nextTruncateAttempt }
}
