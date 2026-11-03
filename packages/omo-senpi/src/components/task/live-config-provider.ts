import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { ComponentLogger } from "../../extension/types"
import type { SenpiOmoConfigResult } from "../config-resolution"

export interface LiveConfigProviderOptions {
  readonly cwd: string
  readonly loadConfig: (options: { cwd: string }) => SenpiOmoConfigResult
  readonly initialResult: SenpiOmoConfigResult
  readonly logger: ComponentLogger
  readonly cacheTtlMs?: number
}

/**
 * Creates a cached, resilient live OmoConfig provider for the task planner.
 * - Caches config reads within cacheTtlMs to eliminate redundant disk/schema loads during a plan.
 * - Adopts reloaded config only when diagnostics are clean (diagnostics.length === 0).
 * - When syntax/validation errors or diagnostics occur, retains the last known good config and logs a diagnostic warning.
 */
export function createLiveConfigProvider(options: LiveConfigProviderOptions): () => OmoConfig {
  const { cwd, loadConfig, initialResult, logger, cacheTtlMs = 250 } = options
  let lastGoodConfig = initialResult.config
  let cachedConfig = initialResult.config
  let lastCachedTime = Date.now()

  return (): OmoConfig => {
    const now = Date.now()
    if (now - lastCachedTime < cacheTtlMs) {
      return cachedConfig
    }
    lastCachedTime = now
    try {
      const reloaded = loadConfig({ cwd })
      if (reloaded.diagnostics.length === 0) {
        lastGoodConfig = reloaded.config
        cachedConfig = reloaded.config
      } else {
        logger.warn("omo-senpi task: live config reload encountered diagnostics; retaining last good configuration", {
          diagnostics: reloaded.diagnostics,
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
