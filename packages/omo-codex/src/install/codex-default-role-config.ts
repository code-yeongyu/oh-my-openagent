import { loadOmoConfig, type LoadOmoConfigOptions } from "../../../omo-config-core/src"

export function readDefaultRoleConfig(options: Omit<LoadOmoConfigOptions, "harness"> = {}): {
  readonly enabled: boolean
  readonly warnings: readonly string[]
} {
  const result = loadOmoConfig({ ...options, harness: "codex" })
  return {
    enabled: result.config.agents?.default?.disable !== true,
    warnings: result.diagnostics.map((diagnostic) => diagnostic.message),
  }
}
