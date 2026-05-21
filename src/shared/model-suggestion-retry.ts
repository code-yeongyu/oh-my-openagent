import type { createOpencodeClient } from "@opencode-ai/sdk"
import { parseModelSuggestion as parseModelSuggestionFromCore } from "@oh-my-opencode/model-core"
import { log } from "./logger"
import {
  createPromptTimeoutContext,
  PROMPT_TIMEOUT_MS,
  type PromptRetryOptions,
} from "./prompt-timeout-context"
import {
  dispatchInternalPrompt,
  isInternalPromptDispatchAccepted,
  releasePromptAsyncReservation,
} from "./prompt-async-gate"
import { isAmbiguousPostDispatchPromptFailure } from "./prompt-failure-classifier"

type Client = ReturnType<typeof createOpencodeClient>

export type { ModelSuggestionInfo } from "@oh-my-opencode/model-core"
export { parseModelSuggestionFromCore as parseModelSuggestion }

function extractMessage(error: unknown): string {
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>
    if (typeof obj.message === "string") return obj.message
    try {
      return JSON.stringify(error)
    } catch {
      return ""
    }
  }
  return String(error)
}

function isAgentResolutionError(error: unknown): boolean {
  const message = extractMessage(error)
  return message.includes("Agent not found") || message.includes("agent.name")
}

function shouldReleaseReservationAfterFailedAsyncPrompt(error: unknown): boolean {
  return parseModelSuggestionFromCore(error) !== null || isAgentResolutionError(error)
}

interface PromptBody {
  model?: { providerID: string; modelID: string }
  [key: string]: unknown
}

interface PromptArgs {
  path: { id: string }
  body: PromptBody
  signal?: AbortSignal
  [key: string]: unknown
}

export async function promptWithModelSuggestionRetry(
  client: Client,
  args: PromptArgs,
  options: PromptRetryOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? PROMPT_TIMEOUT_MS
  const timeoutContext = createPromptTimeoutContext(args, timeoutMs)

  try {
    const promptResult = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: args.path.id,
      input: {
        ...args,
        signal: timeoutContext.signal,
      } as Parameters<typeof client.session.promptAsync>[0],
      source: "model-suggestion-retry",
      settleMs: 0,
      ...(options.queueBehavior ? { queueBehavior: options.queueBehavior } : {}),
    })
    if (promptResult.status === "failed") {
      if (timeoutContext.wasTimedOut()) {
        throw new Error(`promptAsync timed out after ${timeoutMs}ms`)
      }
      if (isAmbiguousPostDispatchPromptFailure(promptResult)) {
        return
      }
      throw promptResult.error
    }
    if (!isInternalPromptDispatchAccepted(promptResult)) {
      throw new Error(`promptAsync skipped by gate: ${promptResult.status}`)
    }
    if (timeoutContext.wasTimedOut()) {
      throw new Error(`promptAsync timed out after ${timeoutMs}ms`)
    }
  } catch (error) {
    if (timeoutContext.wasTimedOut()) {
      throw new Error(`promptAsync timed out after ${timeoutMs}ms`)
    }
    if (shouldReleaseReservationAfterFailedAsyncPrompt(error)) {
      releasePromptAsyncReservation(args.path.id, "model-suggestion-retry")
    }
    throw error
  } finally {
    timeoutContext.cleanup()
  }
}

export async function promptSyncWithModelSuggestionRetry(
  client: Client,
  args: PromptArgs,
  options: PromptRetryOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? PROMPT_TIMEOUT_MS

  try {
    const timeoutContext = createPromptTimeoutContext(args, timeoutMs)
    try {
      const promptResult = await dispatchInternalPrompt({
        mode: "sync",
        client,
        sessionID: args.path.id,
        input: {
          ...args,
          signal: timeoutContext.signal,
        } as Parameters<typeof client.session.prompt>[0],
        source: "model-suggestion-retry:sync",
        settleMs: 0,
        checkStatus: false,
        checkToolState: false,
        ...(options.queueBehavior ? { queueBehavior: options.queueBehavior } : {}),
      })
      if (promptResult.status === "failed") {
        if (timeoutContext.wasTimedOut()) {
          throw new Error(`prompt timed out after ${timeoutMs}ms`)
        }
        if (isAmbiguousPostDispatchPromptFailure(promptResult)) {
          return
        }
        throw promptResult.error
      }
      if (!isInternalPromptDispatchAccepted(promptResult)) {
        throw new Error(`prompt skipped by gate: ${promptResult.status}`)
      }
      if (timeoutContext.wasTimedOut()) {
        throw new Error(`prompt timed out after ${timeoutMs}ms`)
      }
    } catch (error) {
      if (timeoutContext.wasTimedOut()) {
        throw new Error(`prompt timed out after ${timeoutMs}ms`)
      }
      throw error
    } finally {
      timeoutContext.cleanup()
    }
  } catch (error) {
    const suggestion = parseModelSuggestionFromCore(error)
    if (!suggestion || !args.body.model) {
      throw error
    }

    // The first attempt failed synchronously with ProviderModelNotFoundError, which means the
    // prompt did not reach the server. Release the post-dispatch reservation hold so the
    // immediate retry can dispatch without waiting for the hold window to expire.
    releasePromptAsyncReservation(args.path.id, "model-suggestion-retry:sync")

    log("[model-suggestion-retry] Model not found, retrying with suggestion", {
      original: `${suggestion.providerID}/${suggestion.modelID}`,
      suggested: suggestion.suggestion,
    })

    const retryArgs: PromptArgs = {
      ...args,
      body: {
        ...args.body,
        model: {
          providerID: suggestion.providerID,
          modelID: suggestion.suggestion,
        },
      },
    }

    const timeoutContext = createPromptTimeoutContext(retryArgs, timeoutMs)
    try {
      const promptResult = await dispatchInternalPrompt({
        mode: "sync",
        client,
        sessionID: retryArgs.path.id,
        input: {
          ...retryArgs,
          signal: timeoutContext.signal,
        } as Parameters<typeof client.session.prompt>[0],
        source: "model-suggestion-retry:sync-retry",
        settleMs: 0,
        checkStatus: false,
        checkToolState: false,
        ...(options.queueBehavior ? { queueBehavior: options.queueBehavior } : {}),
      })
      if (promptResult.status === "failed") {
        if (timeoutContext.wasTimedOut()) {
          throw new Error(`prompt timed out after ${timeoutMs}ms`)
        }
        if (isAmbiguousPostDispatchPromptFailure(promptResult)) {
          return
        }
        throw promptResult.error
      }
      if (!isInternalPromptDispatchAccepted(promptResult)) {
        throw new Error(`prompt skipped by gate: ${promptResult.status}`)
      }
      if (timeoutContext.wasTimedOut()) {
        throw new Error(`prompt timed out after ${timeoutMs}ms`)
      }
    } catch (retryError) {
      if (timeoutContext.wasTimedOut()) {
        throw new Error(`prompt timed out after ${timeoutMs}ms`)
      }
      throw retryError
    } finally {
      timeoutContext.cleanup()
    }
  }
}
