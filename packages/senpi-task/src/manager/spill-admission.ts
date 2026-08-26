import type { ResolvedModelRecord } from "../state"
import type { ResolvedChildPlan } from "./types"
import type { TaskConcurrency } from "./concurrency"

export type SpillAdmission = {
  readonly plan: ResolvedChildPlan
  readonly lease: SpillLease | undefined
}

export type SpillLease = {
  readonly taskId: string
  readonly epoch: number
  release(): void
}

type Candidate = {
  readonly model: string
  readonly resolved: ResolvedModelRecord | undefined
  readonly index: number
}

export function admitSpill(
  plan: ResolvedChildPlan,
  concurrency: TaskConcurrency,
  taskId: string,
  epoch: number,
): SpillAdmission {
  const candidates = candidatesFor(plan, concurrency)
  for (const candidate of candidates) {
    if (!concurrency.tryAcquire(candidate.model, taskId, epoch)) continue
    const selectedPlan = candidate.index === 0 ? plan : effectivePlan(plan, candidate)
    return {
      plan: selectedPlan,
      lease: { taskId, epoch, release: () => concurrency.releaseLease(taskId, epoch) },
    }
  }
  return { plan, lease: undefined }
}

export function spillCandidates(plan: ResolvedChildPlan, concurrency: TaskConcurrency): readonly string[] {
  return candidatesFor(plan, concurrency).map((candidate) => candidate.model)
}

function candidatesFor(plan: ResolvedChildPlan, concurrency: TaskConcurrency): readonly Candidate[] {
  const models = [
    { model: plan.model, resolved: plan.resolved_model },
    ...(plan.fallback_models ?? []).map((resolved) => ({ model: resolved.display, resolved })),
  ]
  const seen = new Set<string>()
  const candidates: Candidate[] = []
  for (const [index, candidate] of models.entries()) {
    const key = concurrency.getKey(candidate.model)
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({ ...candidate, index })
  }
  return candidates
}

function effectivePlan(plan: ResolvedChildPlan, candidate: Candidate): ResolvedChildPlan {
  const remaining = (plan.fallback_models ?? []).slice(candidate.index)
  return {
    ...plan,
    model: candidate.model,
    resolved_model: candidate.resolved,
    ...(remaining.length === 0 ? { fallback_models: [] } : { fallback_models: remaining }),
  }
}
