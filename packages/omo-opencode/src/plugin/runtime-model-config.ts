import type { OmoConfigEnv } from "@oh-my-opencode/omo-config-core"
import { isDeepStrictEqual } from "node:util"
import type { OhMyOpenCodeConfig } from "../config"
import { validatePluginConfig } from "../config/validate"
import { log } from "../shared/logger"

export type RuntimeConfigDiagnostic = {
  readonly code: "validation-error" | "ignored-value" | "read-failed"
  readonly count: number
}

export type RuntimeModelConfigStatus = {
  readonly acceptedRevision: number
  readonly lastReload: {
    readonly outcome: "startup" | "accepted" | "rejected"
    readonly diagnostics: readonly RuntimeConfigDiagnostic[]
  }
}

export type SavedRuntimeModelConfigStatus = RuntimeModelConfigStatus & {
  readonly saved: {
    readonly valid: boolean
    readonly matchesAccepted: boolean | null
    readonly diagnostics: readonly RuntimeConfigDiagnostic[]
  }
}

/** Each accepted reload replaces the snapshot; existing dispatches keep their resolved config. */
export function createRuntimeModelConfigLoader(
  directory: string,
  initialConfig: Pick<OhMyOpenCodeConfig, "agents" | "categories">,
  environment: OmoConfigEnv = process.env,
) {
  let current = { agents: initialConfig.agents, categories: initialConfig.categories }
  let acceptedRevision = 1
  let lastReload: RuntimeModelConfigStatus["lastReload"] = { outcome: "startup", diagnostics: [] }

  function readCandidate() {
    try {
      const validation = validatePluginConfig(directory, environment)
      const diagnostics: RuntimeConfigDiagnostic[] = []
      if (!validation.valid || validation.messages.length > 0) diagnostics.push({ code: "validation-error", count: Math.max(1, validation.messages.length) })
      if (validation.warnings.length > 0) diagnostics.push({ code: "ignored-value", count: validation.warnings.length })
      return { config: { agents: validation.config.agents, categories: validation.config.categories }, diagnostics }
    } catch {
      return { config: undefined, diagnostics: [{ code: "read-failed", count: 1 }] satisfies RuntimeConfigDiagnostic[] }
    }
  }

  function status(): RuntimeModelConfigStatus {
    return structuredClone({ acceptedRevision, lastReload })
  }

  // Observing a saved candidate must not accept it or alter the last dispatch result.
  function inspect(): SavedRuntimeModelConfigStatus {
    const candidate = readCandidate()
    const valid = candidate.diagnostics.length === 0
    return { ...status(), saved: { valid, matchesAccepted: valid ? isDeepStrictEqual(candidate.config, current) : null, diagnostics: candidate.diagnostics } }
  }

  function load() {
    const candidate = readCandidate()
    // Invalid leaves can be pruned with only a warning. Never accept that partial edit.
    if (candidate.config === undefined || candidate.diagnostics.length > 0) {
      lastReload = { outcome: "rejected", diagnostics: candidate.diagnostics }
      log("[runtime-model-config] Reload rejected; keeping the last valid model config", { diagnostics: candidate.diagnostics })
      return current
    }
    if (!isDeepStrictEqual(current, candidate.config)) acceptedRevision += 1
    current = candidate.config
    lastReload = { outcome: "accepted", diagnostics: [] }
    return current
  }

  return Object.assign(load, { status, inspect })
}
