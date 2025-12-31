#!/usr/bin/env bun
import { Command } from "commander"
import { install } from "./install"
import { run } from "./run"
import { getLocalVersion } from "./get-local-version"
import { doctor } from "./doctor"
import { logs } from "./logs"
import type { InstallArgs } from "./types"
import type { RunOptions } from "./run"
import type { GetLocalVersionOptions } from "./get-local-version/types"
import type { DoctorOptions } from "./doctor"
import type { LogsOptions } from "./logs"

const packageJson = await import("../../package.json")
const VERSION = packageJson.version

const program = new Command()

program
  .name("oh-my-opencode")
  .description("The ultimate OpenCode plugin - multi-model orchestration, LSP tools, and more")
  .version(VERSION, "-v, --version", "Show version number")

program
  .command("install")
  .description("Install and configure oh-my-opencode with interactive setup")
  .option("--no-tui", "Run in non-interactive mode (requires all options)")
  .option("--claude <value>", "Claude subscription: no, yes, max20")
  .option("--chatgpt <value>", "ChatGPT subscription: no, yes")
  .option("--gemini <value>", "Gemini integration: no, yes")
  .option("--skip-auth", "Skip authentication setup hints")
  .addHelpText("after", `
Examples:
  $ bunx oh-my-opencode install
  $ bunx oh-my-opencode install --no-tui --claude=max20 --chatgpt=yes --gemini=yes
  $ bunx oh-my-opencode install --no-tui --claude=no --chatgpt=no --gemini=no

Model Providers:
  Claude      Required for Sisyphus (main orchestrator) and Librarian agents
  ChatGPT     Powers the Oracle agent for debugging and architecture
  Gemini      Powers frontend, documentation, and multimodal agents
`)
  .action(async (options) => {
    const args: InstallArgs = {
      tui: options.tui !== false,
      claude: options.claude,
      chatgpt: options.chatgpt,
      gemini: options.gemini,
      skipAuth: options.skipAuth ?? false,
    }
    const exitCode = await install(args)
    process.exit(exitCode)
  })

program
  .command("run <message>")
  .description("Run opencode with todo/background task completion enforcement")
  .option("-a, --agent <name>", "Agent to use (default: Sisyphus)")
  .option("-d, --directory <path>", "Working directory")
  .option("-t, --timeout <ms>", "Timeout in milliseconds (default: 30 minutes)", parseInt)
  .addHelpText("after", `
Examples:
  $ bunx oh-my-opencode run "Fix the bug in index.ts"
  $ bunx oh-my-opencode run --agent Sisyphus "Implement feature X"
  $ bunx oh-my-opencode run --timeout 3600000 "Large refactoring task"

Unlike 'opencode run', this command waits until:
  - All todos are completed or cancelled
  - All child sessions (background tasks) are idle
`)
  .action(async (message: string, options) => {
    const runOptions: RunOptions = {
      message,
      agent: options.agent,
      directory: options.directory,
      timeout: options.timeout,
    }
    const exitCode = await run(runOptions)
    process.exit(exitCode)
  })

program
  .command("get-local-version")
  .description("Show current installed version and check for updates")
  .option("-d, --directory <path>", "Working directory to check config from")
  .option("--json", "Output in JSON format for scripting")
  .addHelpText("after", `
Examples:
  $ bunx oh-my-opencode get-local-version
  $ bunx oh-my-opencode get-local-version --json
  $ bunx oh-my-opencode get-local-version --directory /path/to/project

This command shows:
  - Current installed version
  - Latest available version on npm
  - Whether you're up to date
  - Special modes (local dev, pinned version)
`)
  .action(async (options) => {
    const versionOptions: GetLocalVersionOptions = {
      directory: options.directory,
      json: options.json ?? false,
    }
    const exitCode = await getLocalVersion(versionOptions)
    process.exit(exitCode)
  })

program
  .command("doctor")
  .description("Check oh-my-opencode installation health and diagnose issues")
  .option("--verbose", "Show detailed diagnostic information")
  .option("--json", "Output results in JSON format")
  .option("--category <category>", "Run only specific category")
  .addHelpText("after", `
Examples:
  $ bunx oh-my-opencode doctor
  $ bunx oh-my-opencode doctor --verbose
  $ bunx oh-my-opencode doctor --json
  $ bunx oh-my-opencode doctor --category authentication

Categories:
  installation     Check OpenCode and plugin installation
  configuration    Validate configuration files
  authentication   Check auth provider status
  dependencies     Check external dependencies
  tools            Check LSP and MCP servers
  updates          Check for version updates
`)
  .action(async (options) => {
    const doctorOptions: DoctorOptions = {
      verbose: options.verbose ?? false,
      json: options.json ?? false,
      category: options.category,
    }
    const exitCode = await doctor(doctorOptions)
    process.exit(exitCode)
  })

program
  .command("logs")
  .description("View and manage oh-my-opencode logs")
  .option("-n, --lines <count>", "Number of lines to show (default: 50)", parseInt)
  .option("-f, --follow", "Follow logs in real-time (tail -f style)")
  .option("--level <level>", "Filter by level: all, info, warn, error")
  .option("--json", "Output in JSON format")
  .option("--clear", "Clear the log file")
  .option("--path", "Show log file path")
  .addHelpText("after", `
Examples:
  $ bunx oh-my-opencode logs
  $ bunx oh-my-opencode logs -n 100
  $ bunx oh-my-opencode logs -f
  $ bunx oh-my-opencode logs --level error
  $ bunx oh-my-opencode logs --json
  $ bunx oh-my-opencode logs --clear
  $ bunx oh-my-opencode logs --path

Log Levels:
  all       Show all log entries (default)
  info      Show info and above
  warn      Show warnings and errors
  error     Show errors only
`)
  .action(async (options) => {
    const logsOptions: LogsOptions = {
      lines: options.lines ?? 50,
      follow: options.follow ?? false,
      level: options.level ?? "all",
      json: options.json ?? false,
      clear: options.clear ?? false,
      path: options.path ?? false,
    }
    const exitCode = await logs(logsOptions)
    process.exit(exitCode)
  })

program
  .command("version")
  .description("Show version information")
  .action(() => {
    console.log(`oh-my-opencode v${VERSION}`)
  })

program.parse()
