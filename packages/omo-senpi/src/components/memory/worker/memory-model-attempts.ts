import type { ReflectionChildResult } from "./spawn"
import type { ReflectionModelCandidate } from "./resolve-model"
import { classifyRetryableModelMiss, type RetryableModelMiss } from "./model-miss"
import type { RunAttempt } from "./run-artifacts"

export type MemoryModelChain = readonly [
  ReflectionModelCandidate,
  ...ReflectionModelCandidate[],
]

export type MemoryModelAttempt = {
  readonly candidate: ReflectionModelCandidate
  readonly child: ReflectionChildResult
}

export type ExhaustedMemoryModelAttempt = {
  readonly candidate: ReflectionModelCandidate
  readonly miss: RetryableModelMiss
}

export class MemoryModelExhaustedError extends Error {
  constructor(readonly attempts: readonly ExhaustedMemoryModelAttempt[]) {
    super(formatMemoryModelExhaustion(attempts))
    this.name = "MemoryModelExhaustedError"
  }
}

export async function runMemoryModelAttempts(
  candidates: MemoryModelChain,
  attempt: (
    candidate: ReflectionModelCandidate,
    attempt: number,
    nextAttempt: RunAttempt | undefined,
  ) => Promise<ReflectionChildResult>,
): Promise<MemoryModelAttempt> {
  const misses: ExhaustedMemoryModelAttempt[] = []
  for (const [index, candidate] of candidates.entries()) {
    const nextCandidate = candidates[index + 1]
    const nextAttempt = nextCandidate === undefined
      ? undefined
      : {
          attempt: index + 2,
          model: nextCandidate.model,
          ...(nextCandidate.thinking === undefined ? {} : { thinking: nextCandidate.thinking }),
        }
    const child = await attempt(candidate, index + 1, nextAttempt)
    const miss = classifyRetryableModelMiss(child)
    if (miss === undefined) return { candidate, child }
    misses.push({ candidate, miss })
  }

  throw new MemoryModelExhaustedError(misses)
}

function formatMemoryModelExhaustion(attempts: readonly ExhaustedMemoryModelAttempt[]): string {
  const modelIds = attempts.flatMap(({ miss }) => miss.kind === "model_not_visible" ? [miss.id] : [])
  const providers = attempts.flatMap(({ miss }) => miss.kind === "auth_missing" ? [miss.provider] : [])
  const outages = attempts.flatMap(({ miss }) => miss.kind === "provider_unavailable" ? [miss.detail] : [])
  return [
    modelIds.length === 0 ? undefined : `model_not_visible:${modelIds.join(",")}`,
    providers.length === 0 ? undefined : `auth_missing:${providers.join(",")}`,
    outages.length === 0 ? undefined : `provider_unavailable:${outages.join(" | ")}`,
    `attempted:${attempts.map(({ candidate }) => candidate.model).join(",")}`,
  ].filter((part): part is string => part !== undefined).join("; ")
}
