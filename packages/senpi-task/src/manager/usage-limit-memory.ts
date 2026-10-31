import type { ResolvedModelRecord } from "../state"
import { usageLimitScope } from "./credential-failure"

/** How long a spent limit is remembered when the provider states no reset time. */
export const LIMIT_MEMORY_DEFAULT_MS = 60 * 60_000
/** How long the one same-provider probe rung may stay silent before its provider counts as spent. */
export const LIMIT_PROBE_TIMEOUT_MS = 60_000
/** Routing evidence from a silent or otherwise failed probe expires quickly, not at the original reset. */
export const LIMIT_PROBE_FAILURE_MEMORY_MS = 30 * 60_000

const RESETS_AT = /\bresets?\s+(?:at\s+)?(\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)/i
const FAMILY = /opus|sonnet|haiku|fable|mythos/i

/** Rungs whose limit is shared: a named Claude family, otherwise the model itself. */
export function modelFamily(modelId: string): string {
  return FAMILY.exec(modelId)?.[0].toLowerCase() ?? modelId
}

export type UsageLimitProbe = { readonly provider: string; readonly message: string; readonly until: number }

/**
 * Usage-limit verdicts the task manager has already paid for, shared by every child it runs (#11383): a provider
 * whose account is spent and a model family whose own limit is spent, each until its stated reset (`Resets at
 * <ISO>`) or LIMIT_MEMORY_DEFAULT_MS. A later child skips them instead of re-probing the family or re-discovering
 * the account limit. `probe` marks a task whose ambiguous limit hopped onto a same-provider rung: ANY failure of
 * that rung (a limit, an error or the probe timeout) confirms the provider's account limit.
 */
export type UsageLimitMemory = {
  readonly accountSpent: (provider: string) => boolean
  readonly familySpent: (provider: string, modelId: string) => boolean
  readonly spentReason: (provider: string, modelId: string) => string | undefined
  readonly settle: (taskId: string, provider: string, modelId: string, message: string, probeTimedOut?: boolean) => void
  readonly beginProbe: (taskId: string, provider: string, message: string) => void
  readonly probeOf: (taskId: string) => UsageLimitProbe | undefined
  readonly endProbe: (taskId: string) => void
}

export function createUsageLimitMemory(now: () => number): UsageLimitMemory {
  const spent = new Map<string, { readonly until: number; readonly message: string }>()
  const probes = new Map<string, UsageLimitProbe>()
  const until = (message: string): number => {
    const reset = Date.parse(RESETS_AT.exec(message)?.[1] ?? "")
    return Number.isFinite(reset) ? reset : now() + LIMIT_MEMORY_DEFAULT_MS
  }
  const live = (key: string): string | undefined => {
    const entry = spent.get(key)
    return entry !== undefined && entry.until > now() ? entry.message : undefined
  }
  const spentReason = (provider: string, modelId: string): string | undefined =>
    live(provider) ?? live(`${provider}/${modelFamily(modelId)}`)
  return {
    accountSpent: (provider) => live(provider) !== undefined,
    familySpent: (provider, modelId) => spentReason(provider, modelId) !== undefined,
    spentReason,
    settle: (taskId, provider, modelId, message, probeTimedOut = false) => {
      const probe = probes.get(taskId)
      probes.delete(taskId)
      const scope = usageLimitScope(message)
      if (probe?.provider === provider) {
        spent.set(provider, {
          until: scope !== undefined && !probeTimedOut ? until(message) : now() + LIMIT_PROBE_FAILURE_MEMORY_MS,
          message,
        })
      } else if (scope === "account") {
        spent.set(provider, { until: until(message), message })
      } else if (scope !== undefined) {
        spent.set(`${provider}/${modelFamily(modelId)}`, { until: until(message), message })
      }
    },
    beginProbe: (taskId, provider, message) => {
      probes.set(taskId, { provider, message, until: until(message) })
    },
    probeOf: (taskId) => probes.get(taskId),
    endProbe: (taskId) => {
      probes.delete(taskId)
    },
  }
}

/**
 * A new child never starts on a rung whose limit an earlier child already found spent: it starts on the first rung
 * the memory clears, or, when every rung is spent, it is refused with the remembered reason (#11383).
 */
export function routeAroundSpentLimits<Plan extends {
  readonly model: string
  readonly resolved_model?: ResolvedModelRecord
  readonly fallback_models?: readonly ResolvedModelRecord[]
}>(plan: Plan, limits: UsageLimitMemory): { readonly plan: Plan } | { readonly spent: string } {
  const primary = plan.resolved_model
  const reason = primary === undefined ? undefined : limits.spentReason(primary.provider, primary.model_id)
  if (reason === undefined) return { plan }
  const usable = (plan.fallback_models ?? []).filter((rung) => !limits.familySpent(rung.provider, rung.model_id))
  const [next, ...rest] = usable
  if (next === undefined) return { spent: reason }
  return { plan: { ...plan, model: next.display, resolved_model: next, fallback_models: rest } }
}
