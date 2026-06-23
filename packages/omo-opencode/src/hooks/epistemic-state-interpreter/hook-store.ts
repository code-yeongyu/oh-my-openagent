import { HOOK_STRENGTH_VALUES } from "./hook-entity-types"
import type {
  EpistemicHook,
  HookBalance,
  HookFactors,
  HookPolarity,
  HookStrength,
} from "./hook-entity-types"

const store = new Map<string, Map<string, EpistemicHook>>()
let nextId = 0

function generateId(): string {
  nextId += 1
  return `hook_${nextId}`
}

export function createHook(
  sessionId: string,
  target: string,
  polarity: HookPolarity,
  strength: HookStrength,
  factors: HookFactors,
  rationale: string,
): EpistemicHook {
  const sessionHooks = store.get(sessionId) ?? new Map<string, EpistemicHook>()
  store.set(sessionId, sessionHooks)

  const hook: EpistemicHook = {
    id: generateId(),
    target,
    polarity,
    strength,
    factors,
    rationale,
    timestamp: Date.now(),
    sessionId,
  }

  sessionHooks.set(hook.id, hook)

  return hook
}

export function getHooksFor(sessionId: string, target: string): EpistemicHook[] {
  const sessionHooks = store.get(sessionId)

  if (!sessionHooks) {
    return []
  }

  return [...sessionHooks.values()].filter((hook) => hook.target === target)
}

export function getHookBalance(sessionId: string, target: string): HookBalance {
  const hooks = getHooksFor(sessionId, target)
  let positiveCount = 0
  let negativeCount = 0
  let positiveStrengthSum = 0
  let negativeStrengthSum = 0

  for (const hook of hooks) {
    const value = HOOK_STRENGTH_VALUES[hook.strength]

    if (hook.polarity === "positivo") {
      positiveCount += 1
      positiveStrengthSum += value
      continue
    }

    negativeCount += 1
    negativeStrengthSum += value
  }

  const netForce = positiveStrengthSum - negativeStrengthSum
  const direction = netForce > 0 ? "retention" : netForce < 0 ? "expulsion" : "neutral"

  return {
    target,
    positiveCount,
    negativeCount,
    positiveStrengthSum,
    negativeStrengthSum,
    netForce,
    direction,
  }
}

export function updateHookStrength(sessionId: string, hookId: string, newStrength: HookStrength): boolean {
  const hook = store.get(sessionId)?.get(hookId)

  if (!hook) {
    return false
  }

  hook.strength = newStrength
  return true
}

export function clearHooks(sessionId: string): void {
  store.delete(sessionId)
}

export function _resetHookStoreForTesting(): void {
  store.clear()
  nextId = 0
}
