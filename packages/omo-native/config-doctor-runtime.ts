import { loadOmoConfig, omoConfigDiagnosticLines, resolveHomeDir, type OmoConfigEnv } from "@oh-my-opencode/omo-config-core"

/**
 * `omo doctor`'s config lines: one `WARN config: <file>: <key> ignored (...)` per key the loader
 * dropped and one per file it did not load, read through the same view the extension loads
 * (omo-senpi config-resolution: harness "senpi").
 */
export function configDoctorLines(input: { readonly cwd: string; readonly env: OmoConfigEnv }): readonly string[] {
  const { diagnostics } = loadOmoConfig({ cwd: input.cwd, env: input.env, harness: "senpi" })
  return omoConfigDiagnosticLines(diagnostics, { homeDir: resolveHomeDir(input.env) }).map((line) => `WARN ${line}`)
}
