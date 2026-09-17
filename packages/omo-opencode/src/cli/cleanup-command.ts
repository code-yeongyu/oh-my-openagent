import { Option, type Command } from "commander"
import { cleanup, resolveCleanupPlatform } from "./cleanup"
import type { CleanupOptions } from "./cleanup"

type CleanupCommandOptions = {
  readonly platform?: CleanupOptions["platform"]
  readonly codexHome?: CleanupOptions["codexHome"]
  readonly configDir?: CleanupOptions["configDir"]
  readonly project?: CleanupOptions["project"]
  readonly json?: CleanupOptions["json"]
}

type CleanupRootCommandOptions = {
  readonly platform?: CleanupOptions["platform"]
}

export { resolveCleanupPlatform }

export function configureCleanupCommand(program: Command): void {
  program
    .command("cleanup")
    .alias("uninstall")
    .description(
      "Remove managed omo state: OpenCode agent definitions (default) and/or Codex Light state (--platform=codex)",
    )
    .addOption(
      new Option("--platform <platform>", "Cleanup target platform: opencode (default), codex, or both").choices([
        "codex",
        "opencode",
        "both",
      ]),
    )
    .option("--codex-home <path>", "Codex home to clean (defaults to CODEX_HOME or ~/.codex)")
    .option("--config-dir <path>", "OpenCode config dir to clean (defaults to the detected OpenCode config dir)")
    .option("--project <path>", "Project directory to inspect for project-local .opencode agents and .codex artifacts")
    .option("--json", "Output structured JSON result")
    .addHelpText(
      "after",
      `
Examples:
  $ omo-agent-toolkit uninstall
  $ omo-agent-toolkit uninstall --platform=opencode
  $ npx lazycodex-ai uninstall
  $ omo-agent-toolkit uninstall --platform=codex
  $ omo-agent-toolkit cleanup --platform=both
  $ omo-agent-toolkit uninstall --platform=codex --project /path/to/project
`,
    )
    .action(async (options: CleanupCommandOptions) => {
      const rootOptions = program.opts<CleanupRootCommandOptions>()
      const platform = resolveCleanupPlatform({ platform: options.platform ?? rootOptions.platform })
      const exitCode = await cleanup({
        platform,
        codexHome: options.codexHome,
        configDir: options.configDir,
        project: options.project,
        json: options.json ?? false,
      })
      process.exit(exitCode)
    })
}
