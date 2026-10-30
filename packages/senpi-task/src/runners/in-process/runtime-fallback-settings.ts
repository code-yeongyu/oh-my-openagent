import type { SettingsManager } from "@code-yeongyu/senpi"

import { senpiBarrel } from "../../lazy/senpi-barrel"
import type { ResolvedModelRecord } from "../../state"

/** Same-model retry budget merged over the engine defaults for one child. */
export type ChildRetryOverride = {
  readonly maxRetries?: number
  readonly baseDelayMs?: number
}

export type CallerSettingsSource = {
  readonly cwd: string
  readonly agentDir: string
  readonly projectTrusted: boolean
}

type SettingsSnapshot = ReturnType<SettingsManager["getGlobalSettings"]>
type SettingsStorage = Parameters<typeof SettingsManager.fromStorage>[0]
type SettingsScope = Parameters<SettingsStorage["withLock"]>[0]

/**
 * The child's settings: a private in-memory copy of the caller's global and project settings, with
 * ONLY the fallback policy replaced by the child's own (#6478: a child never inherits the caller's
 * fallback chain). Timeouts, compaction, thinking budgets and the rest reach the child unchanged,
 * and nothing the child writes ever reaches the caller's settings files.
 */
export function createRuntimeFallbackSettings(
  caller: CallerSettingsSource,
  selectedModel: string | undefined,
  fallbackModels: readonly ResolvedModelRecord[] | undefined,
  retry?: ChildRetryOverride,
): SettingsManager {
  // SettingsManager is read through the lazy barrel boundary; the only callers reach here from
  // buildChildSessionOptions inside InProcessRunner.start/resume, which already awaited
  // loadSenpiBarrel().
  const { SettingsManager: manager } = senpiBarrel()
  const source = manager.create(caller.cwd, caller.agentDir, { projectTrusted: caller.projectTrusted })
  const retryOverride = {
    ...(retry?.maxRetries === undefined ? {} : { maxRetries: retry.maxRetries }),
    ...(retry?.baseDelayMs === undefined ? {} : { baseDelayMs: retry.baseDelayMs }),
  }
  const chained = selectedModel !== undefined && fallbackModels !== undefined && fallbackModels.length > 0
  const global = withoutChildOwnedRetry(source.getGlobalSettings(), retryOverride)
  const project = withoutChildOwnedRetry(source.getProjectSettings(), retryOverride)
  const childGlobal: SettingsSnapshot = {
    ...global,
    retry: {
      ...global.retry,
      modelFallback: chained,
      ...retryOverride,
      ...(chained ? { fallbackChains: { [selectedModel]: fallbackModels.map(modelSelector) } } : {}),
    },
  }
  return manager.fromStorage(new SnapshotSettingsStorage(childGlobal, project))
}

// A project layer merges over global, so a child-owned key left there would beat the child's value.
function withoutChildOwnedRetry(settings: SettingsSnapshot, retryOverride: ChildRetryOverride): SettingsSnapshot {
  if (settings.retry === undefined) return settings
  const { modelFallback: _modelFallback, fallbackChains: _fallbackChains, fallbackRevertPolicy: _revertPolicy, ...rest } = settings.retry
  const kept = Object.fromEntries(Object.entries(rest).filter(([key]) => !(key in retryOverride)))
  return { ...settings, retry: kept }
}

class SnapshotSettingsStorage implements SettingsStorage {
  readonly #scopes: Record<SettingsScope, string | undefined>

  constructor(global: SettingsSnapshot, project: SettingsSnapshot) {
    this.#scopes = { global: JSON.stringify(global), project: JSON.stringify(project) }
  }

  withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void {
    const next = fn(this.#scopes[scope])
    if (next !== undefined) this.#scopes[scope] = next
  }
}

/** `provider/model[:thinking]`: how a fallback rung is named in a retry fallback chain. */
export function modelSelector(model: ResolvedModelRecord): string {
  const thinking = model.reasoning ?? model.reasoning_effort ?? model.variant
  return thinking === undefined
    ? `${model.provider}/${model.model_id}`
    : `${model.provider}/${model.model_id}:${thinking}`
}
