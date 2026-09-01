export type ReflectionModelPricing = {
  readonly input: number
  readonly cacheRead?: number
}

export type ReflectionLaunchCandidate = {
  readonly model: string
  readonly thinking?: string
  readonly cost?: ReflectionModelPricing
}

export type ReflectionLaunchChoice = {
  readonly choice: "fresh" | "inherit"
  readonly model: string
  readonly thinking?: string
  readonly reason: "cheaper" | "only_candidate" | "no_pricing"
  readonly freshCost?: number
  readonly inheritCost?: number
}

export type ReflectionLaunchInput = {
  readonly fresh?: ReflectionLaunchCandidate
  readonly session?: ReflectionLaunchCandidate
  readonly prefixTokens: number
  readonly workloadTokens: number
  readonly cacheReusable: boolean
}

export function estimateFreshCost(candidate: ReflectionLaunchCandidate, workloadTokens: number): number | undefined {
  if (candidate.cost === undefined) return undefined
  return workloadTokens * candidate.cost.input
}

// Inherit replays the live session prefix. With a reusable provider cache the prefix bills at
// cacheRead and only the delta pays full input price; without it the whole workload pays input.
export function estimateInheritCost(
  candidate: ReflectionLaunchCandidate,
  prefixTokens: number,
  workloadTokens: number,
  cacheReusable: boolean,
): number | undefined {
  if (candidate.cost === undefined) return undefined
  if (!cacheReusable) return workloadTokens * candidate.cost.input
  const cacheRead = candidate.cost.cacheRead ?? candidate.cost.input
  const cachedTokens = Math.min(prefixTokens, workloadTokens)
  const freshTokens = Math.max(0, workloadTokens - cachedTokens)
  return cachedTokens * cacheRead + freshTokens * candidate.cost.input
}

export function chooseReflectionLaunchModel(input: ReflectionLaunchInput): ReflectionLaunchChoice {
  const { fresh, session } = input
  if (fresh === undefined && session === undefined) {
    throw new Error("chooseReflectionLaunchModel requires at least one candidate")
  }
  if (session === undefined && fresh !== undefined) return pick("fresh", fresh, "only_candidate")
  if (fresh === undefined && session !== undefined) return pick("inherit", session, "only_candidate")
  if (fresh === undefined || session === undefined) {
    throw new Error("chooseReflectionLaunchModel requires at least one candidate")
  }

  const freshCost = estimateFreshCost(fresh, input.workloadTokens)
  const inheritCost = estimateInheritCost(session, input.prefixTokens, input.workloadTokens, input.cacheReusable)
  if (freshCost === undefined || inheritCost === undefined) return pick("fresh", fresh, "no_pricing")
  if (inheritCost < freshCost) {
    return { ...pick("inherit", session, "cheaper"), freshCost, inheritCost }
  }
  return { ...pick("fresh", fresh, "cheaper"), freshCost, inheritCost }
}

function pick(
  choice: "fresh" | "inherit",
  candidate: ReflectionLaunchCandidate,
  reason: ReflectionLaunchChoice["reason"],
): ReflectionLaunchChoice {
  return {
    choice,
    model: candidate.model,
    ...(candidate.thinking === undefined ? {} : { thinking: candidate.thinking }),
    reason,
  }
}
