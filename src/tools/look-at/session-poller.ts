import type { createOpencodeClient } from "@opencode-ai/sdk"
import { log } from "../../shared"
import { extractLatestAssistantOutcome, type AssistantOutcome } from "./assistant-message-extractor"

type Client = ReturnType<typeof createOpencodeClient>

export interface PollOptions {
  pollIntervalMs?: number
  timeoutMs?: number
  abortSignal?: AbortSignal
  allowStableIdleWithoutActivity?: boolean
}

const DEFAULT_POLL_INTERVAL_MS = 1000
const DEFAULT_TIMEOUT_MS = 120_000
const IDLE_STABILITY_POLLS_REQUIRED = 3

const TERMINAL_STATUSES = new Set(["idle", "interrupted", "error"])

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
    if (statusResult.error) {
      log(`[look_at] session.status returned error (falling back to messages):`, statusResult.error)
      return { supported: false, type: null }
    }
    const sessionStatus = statusResult.data?.[sessionID]
    return { supported: true, type: sessionStatus?.type ?? null }
  } catch (error) {
    log(`[look_at] session.status error (falling back to messages):`, error)
    return { supported: false, type: null }
  }
}

async function getSessionMessages(client: Client, sessionID: string): Promise<{
  messages: unknown[]
  error: boolean
}> {
  try {
    const messagesResult = await client.session.messages({
      path: { id: sessionID },
    })

    if (messagesResult.error) {
      log(`[look_at] Messages API error:`, messagesResult.error)
      return { messages: [], error: true }
    }

    const rawMessages = messagesResult.data
    return { messages: Array.isArray(rawMessages) ? rawMessages : [], error: false }
  } catch (error) {
    log(`[look_at] Messages fetch error:`, error)
    return { messages: [], error: true }
  }
}

export async function waitForLookAtSessionResult(
  client: Client,
  sessionID: string,
  options?: PollOptions,
): Promise<{ messages: unknown[]; outcome: AssistantOutcome; statusType: string | null }> {
  const pollInterval = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const startTime = Date.now()
  let pollCount = 0
  let sawNonIdleStatus = false
  let lastIdleMessageCount: number | null = null
  let stableIdlePolls = 0
  let hasEverSeenSessionInStatus = false

  while (Date.now() - startTime < timeout) {
    if (options?.abortSignal?.aborted) {
      await abortChildSession(client, sessionID)
      throw new Error(`look_at aborted while waiting for session ${sessionID}`)
    }

    const status = await getSessionStatus(client, sessionID)
    const statusType = status.type
    const isTerminal = statusType !== null && TERMINAL_STATUSES.has(statusType)
    if (status.supported && statusType !== null) {
      hasEverSeenSessionInStatus = true
    }
    // If the SDK supports status but our session has never appeared in the map,
    // treat it as still-starting rather than idle, unless the caller explicitly
    // allows stable idle without activity (in which case empty status means done).
    const supportedButNeverSeen = status.supported && statusType === null && !hasEverSeenSessionInStatus
      && !options?.allowStableIdleWithoutActivity
    const isActive = supportedButNeverSeen || (statusType !== null && !isTerminal)
    const { messages, error: messagesError } = await getSessionMessages(client, sessionID)
    const outcome = extractLatestAssistantOutcome(messages)

    if (outcome.text && !isActive) {
      return { messages, outcome, statusType }
    }

    if (outcome.errorName && !isActive) {
      return { messages, outcome, statusType }
    }

    if (isActive) {
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

      if (messagesError) {
        log(`[look_at] Messages error during idle, continuing to poll`)
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

  throw new Error(`[look_at] Polling timed out after ${timeout}ms waiting for session ${sessionID} to become idle`)
}
