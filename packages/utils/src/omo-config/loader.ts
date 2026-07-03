import { existsSync } from "node:fs"
import { homedir } from "node:os"

import type { HarnessId, OmoConfig } from "../omo-config"
import { BUILT_IN_DEFAULTS, loadConfigFile, mergeOmoConfig, validateHarnessApplicability } from "./body"
import { buildEnvOverrides } from "./env-overrides"
import { resolveOmoConfigPaths, toMissingSource, type OmoConfigSource } from "./resolve"

export interface LoadOmoConfigOptions {
  readonly cwd?: string
  readonly env?: Record<string, string | undefined>
  readonly harness: HarnessId
  readonly homeDir?: string
}

export interface LoadOmoConfigResult {
  readonly config: OmoConfig
  readonly sources: readonly OmoConfigSource[]
  readonly warnings: readonly string[]
}

export function loadOmoConfig(options: LoadOmoConfigOptions): LoadOmoConfigResult {
  const cwd = options.cwd ?? process.cwd()
  const homeDir = options.homeDir ?? process.env["HOME"] ?? process.env["USERPROFILE"] ?? homedir()
  const env = options.env ?? process.env
  let config = BUILT_IN_DEFAULTS
  const sources: OmoConfigSource[] = []
  const warnings: string[] = []

  for (const candidate of resolveOmoConfigPaths({ cwd, homeDir })) {
    if (!existsSync(candidate.path)) {
      if (candidate.scope === "global") {
        sources.push(toMissingSource(candidate))
      }
      continue
    }

    const result = loadConfigFile(candidate.path, options.harness)
    sources.push({
      exists: true,
      loaded: result.loaded,
      path: candidate.path,
      scope: candidate.scope,
    })
    warnings.push(...result.warnings)
    config = mergeOmoConfig(config, result.config)
  }

  const envOverrides = buildEnvOverrides(options.harness, env, warnings, mergeOmoConfig)
  config = mergeOmoConfig(config, envOverrides)
  warnings.push(...validateHarnessApplicability(config, options.harness))

  return { config, sources, warnings }
}
