import { Option, type Command } from "commander"
import { cleanup, resolveCleanupPlatform } from "./cleanup"
import type { CleanupOptions } from "./cleanup"

type CleanupCommandOptions = {
  readonly platform?: CleanupOptions["platform"]
  readonly codexHome?: CleanupOptions["codexHome"]
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
    .description("Clean managed Codex Light state and repair project-local legacy Codex artifacts")
    .addOption(new Option("--platform <platform>", "Cleanup target platform: codex").choices(["codex"]))
    .option("--codex-home <path>", "Codex home to clean (defaults to CODEX_HOME or ~/.codex)")
    .option("--project <path>", "Project directory to inspect for project-local .codex artifacts")
    .option("--json", "Output structured JSON result")
    .addHelpText("after", `
Examples:
  $ npx lazycodex-ai uninstall
  $ omo uninstall --platform=codex
  $ npx lazycodex-ai cleanup
  $ omo cleanup --platform=codex
  $ omo uninstall --platform=codex --project /path/to/project
`)
    .action(async (options: CleanupCommandOptions) => {
      const rootOptions = program.opts<CleanupRootCommandOptions>()
      const platform = resolveCleanupPlatform({ platform: options.platform ?? rootOptions.platform })
      const exitCode = await cleanup({
        platform,
        codexHome: options.codexHome,
        project: options.project,
        json: options.json ?? false,
      })
      process.exit(exitCode)
    })
}
