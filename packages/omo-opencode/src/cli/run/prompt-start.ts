import type { EventState } from "./events"
import type { RunContext, SessionStatus } from "./types"
import { normalizeSDKResponse } from "../../shared"

const DEFAULT_PROMPT_START_TIMEOUT_MS = 30_000
const DEFAULT_PROMPT_START_POLL_INTERVAL_MS = 100

type SessionStatusMap = Record<string, SessionStatus>

export interface PromptStartOptions {
  timeoutMs?: number
  pollIntervalMs?: number
}

function createAbortError(): Error {
  const error = new Error("Prompt start wait aborted")
  error.name = "AbortError"
  return error
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function hasPromptStartEvidence(eventState: EventState): boolean {
  return eventState.mainSessionStarted ||
    eventState.hasReceivedMeaningfulWork ||
    eventState.messageCount > 0 ||
    eventState.currentTool !== null
}

async function readMainSessionStatus(ctx: RunContext): Promise<SessionStatus["type"] | null> {
  if (typeof ctx.client.session.status !== "function") {
    return null
  }

  try {
    const statusRes = await ctx.client.session.status({
      query: { directory: ctx.directory },
    })
    const statuses = normalizeSDKResponse<SessionStatusMap>(statusRes, {})
    return statuses[ctx.sessionID]?.type ?? "idle"
  } catch (error) {
    if (ctx.verbose) {
      console.error(`[run] failed to read session status while waiting for prompt start: ${String(error)}`)
    }
    return null
  }
}

async function hasPersistedMessages(ctx: RunContext): Promise<boolean> {
  if (typeof ctx.client.session.messages !== "function") {
    return false
  }

  try {
    const messagesRes = await ctx.client.session.messages({
      path: { id: ctx.sessionID },
      query: { directory: ctx.directory },
    })
    const messages = normalizeSDKResponse<unknown[]>(messagesRes, [])
    return messages.length > 0
  } catch (error) {
    if (ctx.verbose) {
      console.error(`[run] failed to read session messages while waiting for prompt start: ${String(error)}`)
    }
    return false
  }
}

export async function waitForPromptStart(
  ctx: RunContext,
  eventState: EventState,
  abortController: AbortController,
  options: PromptStartOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROMPT_START_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_PROMPT_START_POLL_INTERVAL_MS
  const startedAt = Date.now()

  while (!abortController.signal.aborted) {
    if (hasPromptStartEvidence(eventState)) {
      return
    }

    if (eventState.mainSessionError) {
      throw new Error(`Session errored before prompt started: ${eventState.lastError ?? "unknown error"}`)
    }

    const status = await readMainSessionStatus(ctx)
    if (status === "busy" || status === "retry") {
      eventState.mainSessionStarted = true
      eventState.mainSessionIdle = false
      return
    }
    if (status === "idle") {
      eventState.mainSessionIdle = true
    }

    if (await hasPersistedMessages(ctx)) {
      eventState.mainSessionStarted = true
      return
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(
        `Prompt did not start within ${timeoutMs}ms; no busy status, message event, or persisted message was observed.`
      )
    }

    await sleep(pollIntervalMs)
  }

  throw createAbortError()
}
