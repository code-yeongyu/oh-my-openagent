import { InvalidArgumentError, type Command } from "commander"

import { boulder } from "./boulder"
import { codexUlwLoop } from "./codex-ulw-loop"
import { refreshModelCapabilities } from "./refresh-model-capabilities"
import { worktreeSweep } from "./worktree-sweep"
import { parseOlderThanDays } from "./worktree-sweep/options"

import { PLUGIN_NAME } from "../shared"
import packageJson from "../../../../package.json" with { type: "json" }

const VERSION = packageJson.version

export function configureRuntimeCommands(program: Command): void {
  program
    .command("refresh-model-capabilities")
    .description("Refresh the cached models.dev-based model capabilities snapshot")
    .option("-d, --directory <path>", "Working directory to read oh-my-opencode config from")
    .option("--source-url <url>", "Override the models.dev source URL")
    .option("--json", "Output refresh summary as JSON")
    .action(async (options: { readonly directory?: string; readonly sourceUrl?: string; readonly json?: boolean }) => {
      const exitCode = await refreshModelCapabilities({
        directory: options.directory,
        sourceUrl: options.sourceUrl,
        json: options.json ?? false,
      })
      process.exit(exitCode)
    })

  program
    .command("version")
    .description("Show version information")
    .action(() => {
      console.log(`${PLUGIN_NAME} v${VERSION}`)
    })

  program
    .command("boulder")
    .description("Show boulder progress, elapsed time, and per-task statistics")
    .option("-d, --directory <path>", "Working directory")
    .option("-w, --work-id <id>", "Filter to a specific work")
    .option("--json", "Output as JSON")
    .action(async (options: { readonly directory?: string; readonly workId?: string; readonly json?: boolean }) => {
      const exitCode = await boulder({
        directory: options.directory,
        workId: options.workId,
        json: options.json ?? false,
      })
      process.exit(exitCode)
    })

  program
    .command("worktree-sweep")
    .description("Report (and optionally remove) stale linked git worktrees")
    .option("--apply", "Actually remove SWEEP worktrees and prune stale metadata (default is dry-run)")
    .option("--older-than <days>", "Sweep unmerged worktrees older than N days (0 = merged-only)", (value: string) => {
      try {
        return parseOlderThanDays(value)
      } catch (error) {
        throw new InvalidArgumentError(error instanceof Error ? error.message : String(error))
      }
    })
    .option("--repo <path>", "Repository to sweep (repeatable)", (value: string, previous: string[] = []) => [...previous, value])
    .option("--json", "Output structured JSON result")
    .addHelpText("after", `
Examples:
  $ omo-agent-toolkit worktree-sweep
  $ omo-agent-toolkit worktree-sweep --older-than=14
  $ omo-agent-toolkit worktree-sweep --repo /path/to/repo --repo /path/to/other --apply

Lines: SWEEP <path> <ref> | KEEP(<reason>) <path> <ref> | PRUNE <path> <ref>
KEEP reasons: locked, external, unmerged, dirty. Dry-run is the default; --apply
removes with 'git worktree remove' (never --force) and then prunes.
`)
    .action(async (options: { readonly apply?: boolean; readonly olderThan?: number; readonly repo?: string[]; readonly json?: boolean }) => {
      const exitCode = await worktreeSweep({
        apply: options.apply === true,
        olderThanDays: options.olderThan ?? 0,
        repos: options.repo,
        json: options.json ?? false,
      })
      process.exit(exitCode)
    })

  program
    .command("ulw-loop [args...]")
    .allowUnknownOption()
    .passThroughOptions()
    .description("Run the Codex LazyCodex ulw-loop CLI")
    .action(async (args: string[] = []) => {
      const exitCode = await codexUlwLoop(args)
      process.exit(exitCode)
    })
}
