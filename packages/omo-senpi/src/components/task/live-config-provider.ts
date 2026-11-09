import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { ComponentLogger } from "../../extension/types"
import type { SenpiConfigDiagnostic, SenpiOmoConfigResult } from "../config-resolution"

export interface LiveConfigProviderOptions {
  readonly cwd: string
  readonly loadConfig: (options: { cwd: string }) => SenpiOmoConfigResult
  readonly initialResult: SenpiOmoConfigResult
  readonly logger: ComponentLogger
  readonly cacheTtlMs?: number
  readonly now?: () => number
}

/**
 * Error severity: the loader could not apply what the file says (a layer that failed to read, parse
 * or validate is dropped whole, and a model reference that cannot resolve falls back), so adopting
 * the reload would silently swap the user's categories for defaults. Every other kind still loads
 * and applies (an ignored unknown key, a pruned invalid value, a deprecated alias, a missing profile
 * falling back to the base view), exactly as the register-time load accepts it.
 */
function isErrorDiagnostic(diagnostic: SenpiConfigDiagnostic): boolean {
  switch (diagnostic.kind) {
    case "parse":
    case "read":
    case "validation":
    case "model_catalog_cycle":
      return true
    case "deprecated-keys":
    case "invalid-value":
    case "profile":
    case "unknown-keys":
      return false
  }
}

/**
 * Creates a cached, resilient live OmoConfig provider for the task planner.
 * - Caches config reads within cacheTtlMs to eliminate redundant disk/schema loads during a plan.
 * - Adopts a reloaded config unless the reload carries an error-severity diagnostic.
 * - On an error-severity diagnostic or a thrown load, retains the last known good config and logs a warning.
 */
export function createLiveConfigProvider(options: LiveConfigProviderOptions): () => OmoConfig {
  const { cwd, loadConfig, initialResult, logger, cacheTtlMs = 250, now = Date.now } = options
  let lastGoodConfig = initialResult.config
  let cachedConfig = initialResult.config
  let lastCachedTime = now()

  return (): OmoConfig => {
    const current = now()
    if (current - lastCachedTime < cacheTtlMs) {
      return cachedConfig
    }
    lastCachedTime = current
    try {
      const reloaded = loadConfig({ cwd })
      const errors = reloaded.diagnostics.filter(isErrorDiagnostic)
      if (errors.length === 0) {
        lastGoodConfig = reloaded.config
        cachedConfig = reloaded.config
      } else {
        logger.warn("omo-senpi task: live config reload encountered errors; retaining last good configuration", {
          diagnostics: errors,
        })
        cachedConfig = lastGoodConfig
      }
    } catch (error) {
      logger.warn("omo-senpi task: live config reload failed; retaining last good configuration", { error })
      cachedConfig = lastGoodConfig
    }
    return cachedConfig
  }
}
