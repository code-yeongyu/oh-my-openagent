import {
  displayOmoConfigPath,
  loadOmoConfig,
  omoConfigDiagnosticLines,
  resolveHomeDir,
  type OmoConfigEnv,
} from "@oh-my-opencode/omo-config-core"
import { loadSenpiOmoConfig } from "@oh-my-opencode/omo-senpi/config-resolution"

/**
 * `omo doctor`'s config lines: one `WARN config: <file>: <key> ignored (...)` per key the loader
 * dropped, one per file it did not load, and one per `agents.<name>.prompt_append` value the
 * omo-senpi resolution could not read, read through the same view the extension loads
 * (omo-senpi config-resolution: harness "senpi" plus the prompt_append pass).
 */
export function configDoctorLines(input: { readonly cwd: string; readonly env: OmoConfigEnv }): readonly string[] {
  const homeDir = resolveHomeDir(input.env)
  const { diagnostics } = loadOmoConfig({ cwd: input.cwd, env: input.env, harness: "senpi" })
  const loaderLines = omoConfigDiagnosticLines(diagnostics, { homeDir }).map((line) => `WARN ${line}`)
  const appendLines = loadSenpiOmoConfig({ cwd: input.cwd, env: input.env })
    .diagnostics.filter((diagnostic) => diagnostic.kind === "prompt_append")
    .map((diagnostic) => `WARN config: ${displayOmoConfigPath(diagnostic.path, homeDir)}: ${diagnostic.message}`)
  return [...loaderLines, ...appendLines]
}
