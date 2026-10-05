import type { ResolvedModelRecord, ChildSpec } from "@oh-my-opencode/senpi-task"

import type { ReflectionModelCandidate } from "./worker/resolve-model"

/** One same-model retry per rung. A `tool_call` child has 90s; the engine's default budget spends
 * ~62s of exponential backoff on the primary alone, so the chain would never be reached in time. */
export const MEMORY_CHILD_SAME_MODEL_RETRIES = 1

export type ChildModelChainSpec = Pick<ChildSpec, "selectedModel" | "fallbackModels" | "retry">

export function childModelChainSpec(input: {
  readonly model: string
  readonly fallbacks: readonly ReflectionModelCandidate[]
}): ChildModelChainSpec {
  if (input.fallbacks.length === 0) return { selectedModel: input.model }
  return {
    selectedModel: input.model,
    fallbackModels: input.fallbacks.map((candidate): ResolvedModelRecord => {
      const [provider, ...rest] = candidate.model.split("/")
      return {
        provider: provider ?? candidate.model,
        model_id: rest.join("/"),
        display: candidate.model,
        ...(candidate.thinking === undefined ? {} : { reasoning: candidate.thinking }),
        source: "category",
      }
    }),
    retry: { maxRetries: MEMORY_CHILD_SAME_MODEL_RETRIES },
  }
}
