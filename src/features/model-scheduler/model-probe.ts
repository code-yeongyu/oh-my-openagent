import { normalizeSDKResponse } from "../../shared"
import { log } from "../../shared/logger"
import { normalizeModelFormat } from "../../shared/model-format-normalizer"
import { createPromptTimeoutContext } from "../../shared/prompt-timeout-context"
import type { ModelProbeResult } from "./types"

type SchedulerSessionClient = {
  create?: (args: {
    body: { title: string; permission: Array<{ permission: string; action: "deny"; pattern: string }> }
    query: { directory: string }
  }) => Promise<{ data?: { id?: string }; error?: unknown }>
  delete?: (args: { path: { id: string } }) => Promise<unknown>
  prompt?: (args: {
    path: { id: string }
    body: {
      parts: Array<{ type: "text"; text: string }>
      tools: { task: boolean; call_omo_agent: boolean; look_at: boolean; read: boolean; question: boolean }
      model: { providerID: string; modelID: string }
    }
    signal?: AbortSignal
  }) => Promise<unknown>
  messages?: (args: { path: { id: string } }) => Promise<unknown>
}

type SchedulerProbeClient = {
  session?: SchedulerSessionClient
}

type ProbeContext = {
  directory: string
  client: SchedulerProbeClient
}

type ProbeConfig = {
  probe_enabled: boolean
  probe_timeout_ms: number
  probe_max_latency_ms: number
}

const MODEL_SCHEDULER_PROBE_PROMPT = "Reply with exactly OK."

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function extractAssistantText(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null

  const assistantMessages = messages
    .filter((message): message is Record<string, unknown> => isObject(message))
    .filter((message) => {
      const info = message["info"]
      return isObject(info) && info["role"] === "assistant"
    })

  const lastAssistantMessage = assistantMessages.at(-1)
  if (!lastAssistantMessage) return null

  const parts = lastAssistantMessage["parts"]
  if (!Array.isArray(parts)) return null

  const text = parts
    .filter((part): part is Record<string, unknown> => isObject(part))
    .filter((part) => part["type"] === "text" && typeof part["text"] === "string")
    .map((part) => part["text"])
    .join("\n")
    .trim()

  return text.length > 0 ? text : null
}

function createSkippedProbeResult(model: string, checkedAt: string): ModelProbeResult {
  return {
    model,
    available: true,
    status: "skipped",
    checkedAt,
  }
}

export function createModelProbeRunner(ctx: ProbeContext, config: ProbeConfig, availableModels: Set<string>) {
  const memoizedResults = new Map<string, Promise<ModelProbeResult>>()

  const probeModel = async (model: string): Promise<ModelProbeResult> => {
    const checkedAt = new Date().toISOString()
    if (!availableModels.has(model)) {
      return {
        model,
        available: false,
        status: "unavailable",
        checkedAt,
      }
    }

    if (!config.probe_enabled) {
      return createSkippedProbeResult(model, checkedAt)
    }

    const sessionClient = ctx.client.session
    if (!sessionClient?.create || !sessionClient.prompt) {
      return createSkippedProbeResult(model, checkedAt)
    }

    let probeSessionId: string | undefined
    let timeoutContext: ReturnType<typeof createPromptTimeoutContext> | undefined

    const normalizedModel = normalizeModelFormat(model)
    if (!normalizedModel) {
      return {
        model,
        available: true,
        status: "error",
        checkedAt,
        error: "invalid model format",
      }
    }

    try {
      const createResult = await sessionClient.create({
        body: {
          title: `model scheduler probe: ${model}`,
          permission: [{ permission: "question", action: "deny", pattern: "*" }],
        },
        query: { directory: ctx.directory },
      })

      if (createResult.error || !createResult.data?.id) {
        return {
          model,
          available: true,
          status: "error",
          checkedAt,
          error: createResult.error ? String(createResult.error) : "missing probe session id",
        }
      }

      probeSessionId = createResult.data.id
      timeoutContext = createPromptTimeoutContext({}, config.probe_timeout_ms)
      const startedAt = Date.now()

      await sessionClient.prompt({
        path: { id: probeSessionId },
        body: {
          parts: [{ type: "text", text: MODEL_SCHEDULER_PROBE_PROMPT }],
          tools: {
            task: false,
            call_omo_agent: false,
            look_at: false,
            read: false,
            question: false,
          },
          model: normalizedModel,
        },
        signal: timeoutContext.signal,
      })

      if (timeoutContext.wasTimedOut()) {
        return {
          model,
          available: true,
          status: "timeout",
          checkedAt,
          error: `probe timed out after ${config.probe_timeout_ms}ms`,
        }
      }

      const latencyMs = Date.now() - startedAt
      if (sessionClient.messages) {
        const messagesResult = await sessionClient.messages({ path: { id: probeSessionId } })
        const messages = normalizeSDKResponse(messagesResult, [] as unknown[], {
          preferResponseOnMissingData: true,
        })
        if (!extractAssistantText(messages)) {
          return {
            model,
            available: true,
            status: "error",
            checkedAt,
            latencyMs,
            error: "probe response contained no assistant text",
          }
        }
      }

      if (latencyMs > config.probe_max_latency_ms) {
        return {
          model,
          available: true,
          status: "slow",
          checkedAt,
          latencyMs,
          error: `probe latency ${latencyMs}ms exceeded ${config.probe_max_latency_ms}ms`,
        }
      }

      return {
        model,
        available: true,
        status: "healthy",
        checkedAt,
        latencyMs,
      }
    } catch (error) {
      return {
        model,
        available: true,
        status: timeoutContext?.wasTimedOut() ? "timeout" : "error",
        checkedAt,
        error: timeoutContext?.wasTimedOut()
          ? `probe timed out after ${config.probe_timeout_ms}ms`
          : error instanceof Error
            ? error.message
            : String(error),
      }
    } finally {
      timeoutContext?.cleanup()
      if (probeSessionId && sessionClient.delete) {
        try {
          await sessionClient.delete({ path: { id: probeSessionId } })
        } catch (error) {
          log(
            `[model-scheduler] failed to delete probe session ${probeSessionId}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    }
  }

  return {
    async probeModels(models: string[]): Promise<Record<string, ModelProbeResult>> {
      const uniqueModels = Array.from(new Set(models.filter((model) => model.length > 0))).sort()

      const entries = await Promise.all(uniqueModels.map(async (model) => {
        const existingProbe = memoizedResults.get(model)
        const probePromise = existingProbe ?? probeModel(model)
        if (!existingProbe) {
          memoizedResults.set(model, probePromise)
        }
        return [model, await probePromise] as const
      }))

      return Object.fromEntries(entries)
    },
  }
}
