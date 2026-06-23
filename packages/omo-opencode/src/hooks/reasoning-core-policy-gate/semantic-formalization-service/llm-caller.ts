import { FormalizationError } from "./errors"
import { FormalizationEnvelopeSchema } from "./schemas"
import type { FormalizationEnvelope, FormalizationRequest } from "./types"

type FormalizationQualityRetryFeedback = {
  qualityWarnings: string[]
}

type ProviderClient = {
  complete(params: {
    prompt: string
    systemPrompt: string
    temperature: number
    responseFormat?: { type: "json_object" | "json_schema" }
    maxTokens?: number
  }): Promise<string>
}

type PromptLoader = {
  load(path: string): Promise<string>
}

type Logger = {
  debug(msg: string, meta?: Record<string, unknown>): void
  info(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
}

type LLMCallerDeps = {
  providerClient: ProviderClient
  promptLoader: PromptLoader
  logger: Logger
  promptPath?: string
  maxRetries?: number
  timeoutMs?: number
}

export type LLMCaller = {
  call(request: FormalizationRequest, feedback?: FormalizationQualityRetryFeedback): Promise<FormalizationEnvelope>
}

const DEFAULT_PROMPT_PATH =
  "src/hooks/reasoning-core-policy-gate/prompts/formalization-prompt.md"

export function createLLMCaller(deps: LLMCallerDeps): LLMCaller {
  const {
    providerClient,
    promptLoader,
    logger,
    promptPath = DEFAULT_PROMPT_PATH,
    maxRetries = 2,
    timeoutMs = 30_000,
  } = deps

  let cachedPrompt: string | null = null

  async function loadPrompt(): Promise<string> {
    if (cachedPrompt !== null) {
      return cachedPrompt
    }

    cachedPrompt = await promptLoader.load(promptPath)

    return cachedPrompt
  }

  async function callProvider(request: FormalizationRequest, feedback?: FormalizationQualityRetryFeedback): Promise<string> {
    const systemPrompt = await loadPrompt()
    const prompt = feedback?.qualityWarnings?.length
      ? `${JSON.stringify(request, null, 2)}\n\nQUALITY FIXES REQUIRED:\n- ${feedback.qualityWarnings.join("\n- ")}`
      : JSON.stringify(request, null, 2)

    return Promise.race([
      providerClient.complete({
        prompt,
        systemPrompt,
        temperature: 0,
        responseFormat: { type: "json_object" },
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs)
      }),
    ])
  }

  function validateResult(result: string): FormalizationEnvelope | null {
    try {
      const parsed = JSON.parse(result)

      const schemaResult = FormalizationEnvelopeSchema.safeParse(parsed)
      return schemaResult.success ? schemaResult.data : null
    } catch {
      return null
    }
  }

  async function callWithRetry(
    request: FormalizationRequest,
    feedback: FormalizationQualityRetryFeedback | undefined,
    retriesLeft: number,
  ): Promise<FormalizationEnvelope> {
    try {
      const result = await callProvider(request, feedback)
      const validatedResult = validateResult(result)

      if (!validatedResult) {
        if (retriesLeft > 0) {
          logger.warn("llm-caller: retrying after invalid schema", { retriesLeft })

          return callWithRetry(request, feedback, retriesLeft - 1)
        }

        throw new FormalizationError({
          code: "schema_invalid",
          message: "LLM response did not match formalization schema",
        })
      }

      if (validatedResult.status === "error") {
        throw new FormalizationError({
          code: mapEnvelopeErrorCode(validatedResult.error_code),
          message: validatedResult.message,
          details: { recoverable: validatedResult.recoverable },
        })
      }

      logger.debug("llm-caller: success", { retriesLeft })

      return validatedResult
    } catch (error) {
      if (error instanceof FormalizationError) {
        throw error
      }

      if (error instanceof Error && error.message === "TIMEOUT") {
        throw new FormalizationError({
          code: "timeout",
          message: "LLM call timed out",
          details: { timeoutMs },
        })
      }

      if (retriesLeft > 0) {
        logger.warn("llm-caller: retrying after provider error", {
          retriesLeft,
          error,
        })

        return callWithRetry(request, feedback, retriesLeft - 1)
      }

      throw new FormalizationError({
        code: "provider_failure",
        message: error instanceof Error ? error.message : "Provider error",
        details: error,
      })
    }
  }

  return {
    async call(request: FormalizationRequest, feedback?: FormalizationQualityRetryFeedback): Promise<FormalizationEnvelope> {
      return callWithRetry(request, feedback, maxRetries)
    },
  }
}

function mapEnvelopeErrorCode(errorCode: FormalizationEnvelope["status"] extends never ? never : "invalid_json" | "schema_mismatch" | "missing_theory" | "malformed_theory") {
  switch (errorCode) {
    case "missing_theory":
      return "missing_theory" as const
    case "malformed_theory":
      return "malformed_theory" as const
    default:
      return "schema_invalid" as const
  }
}
