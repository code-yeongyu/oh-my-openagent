import { Command } from "commander"
import packageJson from "../../package.json" with { type: "json" }
import type { DoctorOptions } from "./doctor"
import { doctor } from "./doctor"
import { getLocalVersion } from "./get-local-version"
import type { GetLocalVersionOptions } from "./get-local-version/types"
import { install } from "./install"
import { createMcpOAuthCommand } from "./mcp-oauth"
import type { RunOptions } from "./run"
import { run } from "./run"
import type { InstallArgs } from "./types"

const VERSION = packageJson.version

const program = new Command()

program
  .name("matrixx")
  .description("The ultimate OpenCode plugin - multi-model orchestration, LSP tools, and more")
  .version(VERSION, "-v, --version", "Show version number")
  .enablePositionalOptions()

program
  .command("install")
  .description("Install and configure matrixx with interactive setup")
  .option("--no-tui", "Run in non-interactive mode (requires all options)")
  .option("--claude <value>", "Claude subscription: no, yes, max20")
  .option("--openai <value>", "OpenAI/ChatGPT subscription: no, yes (default: no)")
  .option("--gemini <value>", "Gemini integration: no, yes")
  .option("--copilot <value>", "GitHub Copilot subscription: no, yes")
  .option("--opencode-zen <value>", "OpenCode Zen access: no, yes (default: no)")
  .option("--zai-coding-plan <value>", "Z.ai Coding Plan subscription: no, yes (default: no)")
  .option("--skip-auth", "Skip authentication setup hints")
  .addHelpText("after", `
Examples:
  $ bunx matrixx install
  $ bunx matrixx install --no-tui --claude=max20 --openai=yes --gemini=yes --copilot=no
  $ bunx matrixx install --no-tui --claude=no --gemini=no --copilot=yes --opencode-zen=yes

Model Providers (Priority: Native > Copilot > OpenCode Zen > Z.ai):
  Claude        Native anthropic/ models (Opus, Sonnet, Haiku)
  OpenAI        Native openai/ models (GPT-5.2 for Oracle)
  Gemini        Native google/ models (Gemini 3 Pro, Flash)
  Copilot       github-copilot/ models (fallback)
  OpenCode Zen  opencode/ models (opencode/claude-opus-4-6, etc.)
  Z.ai          zai-coding-plan/glm-4.7 (Librarian priority)
`)
  .action(async (options) => {
    const args: InstallArgs = {
      tui: options.tui !== false,
      claude: options.claude,
      openai: options.openai,
      gemini: options.gemini,
      copilot: options.copilot,
      opencodeZen: options.opencodeZen,
      zaiCodingPlan: options.zaiCodingPlan,
      skipAuth: options.skipAuth ?? false,
    }
    const exitCode = await install(args)
    process.exit(exitCode)
  })

program
   .command("run <message>")
   .allowUnknownOption()
   .passThroughOptions()
   .description("Run opencode with todo/background task completion enforcement")
  .option("-a, --agent <name>", "Agent to use (default: from CLI/env/config, fallback: Morpheus)")
  .option("-d, --directory <path>", "Working directory")
  .option("-t, --timeout <ms>", "Timeout in milliseconds (default: 30 minutes)", parseInt)
  .option("-p, --port <port>", "Server port (attaches if port already in use)", parseInt)
  .option("--attach <url>", "Attach to existing opencode server URL")
  .option("--on-complete <command>", "Shell command to run after completion")
  .option("--json", "Output structured JSON result to stdout")
  .option("--session-id <id>", "Resume existing session instead of creating new one")
  .addHelpText("after", `
Examples:
  $ bunx matrixx run "Fix the bug in index.ts"
  $ bunx matrixx run --agent Morpheus "Implement feature X"
  $ bunx matrixx run --timeout 3600000 "Large refactoring task"
  $ bunx matrixx run --port 4321 "Fix the bug"
  $ bunx matrixx run --attach http://127.0.0.1:4321 "Fix the bug"
  $ bunx matrixx run --json "Fix the bug" | jq .sessionId
  $ bunx matrixx run --on-complete "notify-send Done" "Fix the bug"
  $ bunx matrixx run --session-id ses_abc123 "Continue the work"

Agent resolution order:
  1) --agent flag
  2) OPENCODE_DEFAULT_AGENT
  3) matrixx.json "default_run_agent"
  4) Morpheus (fallback)

Available core agents:
  Morpheus, Keymaker, Oracle, Architect

Unlike 'opencode run', this command waits until:
  - All todos are completed or cancelled
  - All child sessions (background tasks) are idle
`)
  .action(async (message: string, options) => {
    if (options.port && options.attach) {
      console.error("Error: --port and --attach are mutually exclusive")
      process.exit(1)
    }
    const runOptions: RunOptions = {
      message,
      agent: options.agent,
      directory: options.directory,
      timeout: options.timeout,
      port: options.port,
      attach: options.attach,
      onComplete: options.onComplete,
      json: options.json ?? false,
      sessionId: options.sessionId,
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
  $ bunx matrixx get-local-version
  $ bunx matrixx get-local-version --json
  $ bunx matrixx get-local-version --directory /path/to/project

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
  .description("Check matrixx installation health and diagnose issues")
  .option("--status", "Show compact system dashboard")
  .option("--verbose", "Show detailed diagnostic information")
  .option("--json", "Output results in JSON format")
  .addHelpText("after", `
Examples:
  $ bunx matrixx doctor            # Show problems only
  $ bunx matrixx doctor --status   # Compact dashboard
  $ bunx matrixx doctor --verbose  # Deep diagnostics
  $ bunx matrixx doctor --json     # JSON output
`)
  .action(async (options) => {
    const mode = options.status ? "status" : options.verbose ? "verbose" : "default"
    const doctorOptions: DoctorOptions = {
      mode,
      json: options.json ?? false,
    }
    const exitCode = await doctor(doctorOptions)
    process.exit(exitCode)
  })

program
  .command("version")
  .description("Show version information")
  .action(() => {
    console.log(`matrixx v${VERSION}`)
  })

program.addCommand(createMcpOAuthCommand())

export function runCli(): void {
  program.parse()
}
