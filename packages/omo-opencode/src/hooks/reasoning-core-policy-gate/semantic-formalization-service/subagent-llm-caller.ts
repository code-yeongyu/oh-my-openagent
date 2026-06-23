import { FormalizationError } from "./errors"
import { FormalizationEnvelopeSchema } from "./schemas"
import type { FormalizationEnvelope, FormalizationRequest } from "./types"
import { log } from "../../../shared/logger"

type FormalizationQualityRetryFeedback = {
  qualityWarnings: string[]
}

type TaskDispatcher = {
  dispatch(params: {
    subagentType: string
    loadSkills: string[]
    prompt: string
    description: string
    runInBackground: false
  }): Promise<string>
}

type SubagentLLMCallerDeps = {
  taskDispatcher: TaskDispatcher
  subagentType?: string
  skills?: string[]
  timeoutMs?: number
}

export type SubagentLLMCaller = {
  call(request: FormalizationRequest, feedback?: FormalizationQualityRetryFeedback): Promise<FormalizationEnvelope>
}

export function createSubagentLLMCaller(deps: SubagentLLMCallerDeps): SubagentLLMCaller {
  const {
    taskDispatcher,
    subagentType = "formalizer",
    skills = [],
    timeoutMs = 60_000,
  } = deps

  return {
    async call(request: FormalizationRequest, feedback?: FormalizationQualityRetryFeedback): Promise<FormalizationEnvelope> {
      return callWithRetry(taskDispatcher, request, feedback, timeoutMs, subagentType, skills, 1)
    },
  }
}

async function callWithRetry(
  taskDispatcher: TaskDispatcher,
  request: FormalizationRequest,
  feedback: FormalizationQualityRetryFeedback | undefined,
  timeoutMs: number,
  subagentType: string,
  skills: string[],
  retriesLeft: number,
): Promise<FormalizationEnvelope> {
  try {
    const result = await Promise.race([
      taskDispatcher.dispatch({
        subagentType,
        loadSkills: skills,
        prompt: buildPrompt(request, retriesLeft < 1, feedback),
        description: "NL-to-ASPIC+ formalization",
        runInBackground: false,
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("FORMALIZATION_TIMEOUT")), timeoutMs)),
    ])

    const parsed = parseEnvelope(result)
    if (!parsed.success) {
      if (retriesLeft > 0) {
        return callWithRetry(taskDispatcher, request, feedback, timeoutMs, subagentType, skills, retriesLeft - 1)
      }
      throw new FormalizationError({
        code: "schema_invalid",
        message: "Subagent response did not match the FormalizerResult contract",
        details: { responseLength: result.length, responsePreview: result.slice(0, 200) },
      })
    }

    if (parsed.data.status === "error") {
      throw new FormalizationError({
        code: mapEnvelopeErrorCode(parsed.data.error_code),
        message: parsed.data.message,
        details: { recoverable: parsed.data.recoverable },
      })
    }

    return parsed.data
  } catch (err) {
    if (err instanceof FormalizationError) throw err

    const isTimeout = err instanceof Error && err.message === "FORMALIZATION_TIMEOUT"
    if (isTimeout) {
      throw new FormalizationError({
        code: "timeout",
        message: "Formalization subagent timed out",
        details: { timeoutMs },
      })
    }

    throw new FormalizationError({
      code: "provider_failure",
      message: err instanceof Error ? err.message : "Subagent dispatch failed",
      details: err,
    })
  }
}

function buildPrompt(request: FormalizationRequest, retry: boolean, feedback?: FormalizationQualityRetryFeedback): string {
  return [
    "Formalize the following deliberation request into an ASPIC+ theory envelope.",
    "Return ONLY valid JSON with either {\"status\":\"ok\",\"theory\":{...}} or {\"status\":\"error\",\"error_code\":...,\"message\":...,\"recoverable\":...}.",
    retry ? "Your previous response violated the FormalizerResult contract. Return only valid envelope JSON." : undefined,
    feedback?.qualityWarnings?.length ? `QUALITY FIXES REQUIRED:\n- ${feedback.qualityWarnings.join("\n- ")}` : undefined,
    "",
    JSON.stringify(request, null, 2),
  ].filter(Boolean).join("\n")
}

function parseEnvelope(result: string) {
  try {
    return FormalizationEnvelopeSchema.safeParse(JSON.parse(result))
  } catch {
    return { success: false } as const
  }
}

function mapEnvelopeErrorCode(errorCode: "invalid_json" | "schema_mismatch" | "missing_theory" | "malformed_theory") {
  switch (errorCode) {
    case "missing_theory":
      return "missing_theory" as const
    case "malformed_theory":
      return "malformed_theory" as const
    default:
      return "schema_invalid" as const
  }
}
