import type { createOpencodeClient } from "@opencode-ai/sdk"
import { log } from "../../shared"
import { extractLatestAssistantOutcome, type AssistantExtractionOutcome } from "./assistant-message-extractor"

type Client = ReturnType<typeof createOpencodeClient>

export interface PollOptions {
  pollIntervalMs?: number
  timeoutMs?: number
  abortSignal?: AbortSignal
  allowStableIdleWithoutActivity?: boolean
}

export interface LookAtSessionResult {
  messages: unknown[]
  outcome: AssistantExtractionOutcome
  statusType: string | null
}

const DEFAULT_POLL_INTERVAL_MS = 1000
const DEFAULT_TIMEOUT_MS = 120_000
const IDLE_STABILITY_POLLS_REQUIRED = 3

async function abortChildSession(client: Client, sessionID: string): Promise<void> {
  if (typeof client.session.abort !== "function") {
    return
  }

  try {
    await client.session.abort({ path: { id: sessionID } })
  } catch (error) {
    log(`[look_at] Failed to abort child session ${sessionID}:`, error)
  }
}

async function getSessionStatus(client: Client, sessionID: string): Promise<{
  supported: boolean
  type: string | null
}> {
  if (typeof client.session.status !== "function") {
    return { supported: false, type: null }
  }

  try {
    const statusResult = await client.session.status()
    const sessionStatus = statusResult.data?.[sessionID]
    return { supported: true, type: sessionStatus?.type ?? null }
  } catch (error) {
    log(`[look_at] session.status error (falling back to messages):`, error)
    return { supported: false, type: null }
  }
}

async function getSessionMessages(client: Client, sessionID: string): Promise<unknown[]> {
  const messagesResult = await client.session.messages({
    path: { id: sessionID },
  })

  const rawMessages = messagesResult.data
  return Array.isArray(rawMessages) ? rawMessages : []
}

export async function waitForLookAtSessionResult(
  client: Client,
  sessionID: string,
  options?: PollOptions,
): Promise<LookAtSessionResult> {
  const pollInterval = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const startTime = Date.now()
  let pollCount = 0
  let sawNonIdleStatus = false
  let lastIdleMessageCount: number | null = null
  let stableIdlePolls = 0

  while (Date.now() - startTime < timeoutMs) {
    if (options?.abortSignal?.aborted) {
      await abortChildSession(client, sessionID)
      throw new Error(`look_at aborted while waiting for session ${sessionID}`)
    }

    const status = await getSessionStatus(client, sessionID)
    const statusType = status.type
    const messages = await getSessionMessages(client, sessionID)
    const outcome = extractLatestAssistantOutcome(messages)

    if (outcome.text || outcome.errorName) {
      return { messages, outcome, statusType }
    }

    if (statusType !== null && statusType !== "idle") {
      sawNonIdleStatus = true
      stableIdlePolls = 0
      lastIdleMessageCount = null
    } else {
      const currentMessageCount = messages.length
      stableIdlePolls = currentMessageCount === lastIdleMessageCount ? stableIdlePolls + 1 : 1
      lastIdleMessageCount = currentMessageCount

      if (outcome.hasAssistant && outcome.completed) {
        return { messages, outcome, statusType }
      }

      const canConcludeIdle =
        sawNonIdleStatus ||
        !status.supported ||
        Boolean(options?.allowStableIdleWithoutActivity)

      if (canConcludeIdle && stableIdlePolls >= IDLE_STABILITY_POLLS_REQUIRED) {
        return { messages, outcome, statusType }
      }
    }

    pollCount += 1
    if (pollCount % 10 === 0) {
      log(`[look_at] Waiting for child session ${sessionID}`, {
        elapsedMs: Date.now() - startTime,
        statusType: statusType ?? "unknown",
        messageCount: messages.length,
        sawNonIdleStatus,
      })
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }

  await abortChildSession(client, sessionID)
  throw new Error(`[look_at] Timed out after ${timeoutMs}ms waiting for session ${sessionID} result`)
}
