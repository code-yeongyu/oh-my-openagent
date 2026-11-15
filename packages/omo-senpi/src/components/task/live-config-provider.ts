import { MERGED_OMO_CONFIG_PATH, type OmoConfig } from "@oh-my-opencode/omo-config-core"
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
 * Error severity: the loader could not apply what the file says (a layer that failed to read or parse, or a
 * file or the merged config rejected whole by validation), or a model catalog reference cycles. Adopting such
 * a reload could silently swap the user's categories for defaults. Every other kind still loads and applies:
 * an ignored unknown key, a pruned invalid value, a deprecated alias, a missing profile falling back to the
 * base view, and the model-reference `validation` notices (a profile shadowing a catalog entry, a profile name
 * spliced into a model chain), which name a config key rather than a file the loader read and drop nothing.
 */
function isErrorDiagnostic(diagnostic: SenpiConfigDiagnostic, result: SenpiOmoConfigResult): boolean {
  switch (diagnostic.kind) {
    case "parse":
    case "read":
    case "model_catalog_cycle":
      return true
    case "validation":
      return diagnostic.path === MERGED_OMO_CONFIG_PATH || result.sources.some((source) => source.path === diagnostic.path)
    case "deprecated-keys":
    case "invalid-value":
    case "profile":
    case "unknown-keys":
      return false
  }
}

function fingerprint(diagnostic: SenpiConfigDiagnostic): string {
  return `${diagnostic.kind}\u0000${diagnostic.path}\u0000${diagnostic.message}`
}

function errorFingerprints(result: SenpiOmoConfigResult): ReadonlySet<string> {
  return new Set(result.diagnostics.filter((diagnostic) => isErrorDiagnostic(diagnostic, result)).map(fingerprint))
}

/**
 * Creates a cached, resilient live OmoConfig provider for the task planner.
 * - Caches config reads within cacheTtlMs to eliminate redundant disk/schema loads during a plan.
 * - Rejects a reload only for an error-severity diagnostic the adopted config did not already carry: the session
 *   already runs on an error accepted at startup (or at an earlier adoption), so it never blocks a later edit.
 * - On a rejected or thrown reload, retains the last adopted config and warns once per distinct cause.
 */
export function createLiveConfigProvider(options: LiveConfigProviderOptions): () => OmoConfig {
  const { cwd, loadConfig, initialResult, logger, cacheTtlMs = 250, now = Date.now } = options
  let lastGoodConfig = initialResult.config
  let adoptedErrors = errorFingerprints(initialResult)
  let cachedConfig = initialResult.config
  let lastCachedTime = now()
  let lastWarning: string | undefined

  const warnOnce = (key: string, message: string, meta: Record<string, unknown>): void => {
    if (key === lastWarning) return
    lastWarning = key
    logger.warn(message, meta)
  }

  return (): OmoConfig => {
    const current = now()
    if (current - lastCachedTime < cacheTtlMs) {
      return cachedConfig
    }
    lastCachedTime = current
    try {
      const reloaded = loadConfig({ cwd })
      const introduced = reloaded.diagnostics.filter(
        (diagnostic) => isErrorDiagnostic(diagnostic, reloaded) && !adoptedErrors.has(fingerprint(diagnostic)),
      )
      if (introduced.length === 0) {
        lastGoodConfig = reloaded.config
        adoptedErrors = errorFingerprints(reloaded)
        cachedConfig = reloaded.config
        lastWarning = undefined
      } else {
        warnOnce(
          `errors\u0001${introduced.map(fingerprint).sort().join("\u0001")}`,
          "omo-senpi task: live config reload encountered errors; retaining last good configuration",
          { diagnostics: introduced },
        )
        cachedConfig = lastGoodConfig
      }
    } catch (error) {
      warnOnce(
        `thrown\u0001${error instanceof Error ? error.message : String(error)}`,
        "omo-senpi task: live config reload failed; retaining last good configuration",
        { error },
      )
      cachedConfig = lastGoodConfig
    }
    return cachedConfig
  }
}
