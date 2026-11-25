import {
  loadOmoConfig,
  omoConfigDiagnosticLines,
  resolveHomeDir,
  type OmoConfigEnv,
} from "@oh-my-opencode/omo-config-core"
import { categoryShadowedAgentNames, categoryShadowMessage } from "@oh-my-opencode/senpi-task/category-shadow"

/** One config finding: the shape of bin/lib/diagnostics-findings.js, built here because this runtime is bundled apart. */
export type ConfigDoctorFinding = {
  readonly level: "warn"
  readonly check: "config.diagnostics"
  readonly message: string
  readonly details: Readonly<Record<string, unknown>>
}

/**
 * `omo doctor`'s config findings: one `config: <file>: <key> ignored (...)` per key the loader dropped and one per file
 * it did not load, read through the same view the extension loads (omo-senpi config-resolution: harness "senpi"), plus
 * one per `categories.<name>` key that equals an agent name and so never reaches that agent's spawns (#10323). Each
 * keeps the loader diagnostic it came from as its details.
 */
export function configDoctorFindings(input: {
  readonly cwd: string
  readonly env: OmoConfigEnv
}): readonly ConfigDoctorFinding[] {
  const { config, diagnostics } = loadOmoConfig({ cwd: input.cwd, env: input.env, harness: "senpi" })
  const homeDir = resolveHomeDir(input.env)
  return [
    ...diagnostics.flatMap((diagnostic) =>
      omoConfigDiagnosticLines([diagnostic], { homeDir }).map((message) => ({
        level: "warn" as const,
        check: "config.diagnostics" as const,
        message,
        details: { kind: diagnostic.kind, path: diagnostic.path, issue_paths: diagnostic.issuePaths ?? [] },
      })),
    ),
    ...categoryShadowedAgentNames(config).map((name) => ({
      level: "warn" as const,
      check: "config.diagnostics" as const,
      message: `config: ${categoryShadowMessage(config, name)}`,
      details: { kind: "category-shadows-agent", category: name },
    })),
  ]
}
