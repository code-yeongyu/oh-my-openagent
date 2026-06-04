import { Command, Option } from "commander"
import { install } from "./install"
import { configureCleanupCommand, resolveCleanupPlatform } from "./cleanup-command"
import { run } from "./run"
import { getLocalVersion } from "./get-local-version"
import { doctor } from "./doctor"
import { refreshModelCapabilities } from "./refresh-model-capabilities"
import { createMcpOAuthCommand } from "./mcp-oauth"
import { boulder } from "./boulder"
import { codexUlwLoop } from "./codex-ulw-loop"
import type { InstallArgs } from "./types"
import type { RunOptions } from "./run"
import type { GetLocalVersionOptions } from "./get-local-version/types"
import type { DoctorOptions } from "./doctor"
import packageJson from "../../package.json" with { type: "json" }

const VERSION = packageJson.version

const program = new Command()

type InstallCommandOptions = {
  readonly tui?: boolean
  readonly claude?: InstallArgs["claude"]
  readonly openai?: InstallArgs["openai"]
  readonly gemini?: InstallArgs["gemini"]
  readonly copilot?: InstallArgs["copilot"]
  readonly platform?: InstallArgs["platform"]
  readonly opencodeZen?: InstallArgs["opencodeZen"]
  readonly zaiCodingPlan?: InstallArgs["zaiCodingPlan"]
  readonly kimiForCoding?: InstallArgs["kimiForCoding"]
  readonly opencodeGo?: InstallArgs["opencodeGo"]
  readonly vercelAiGateway?: InstallArgs["vercelAiGateway"]
  readonly codexAutonomous?: InstallArgs["codexAutonomous"]
  readonly skipAuth?: boolean
}

type RootCommandOptions = {
  readonly platform?: InstallArgs["platform"]
}

export function resolveInstallArgs(
  options: InstallCommandOptions,
  invocationName: string | undefined = process.env.OMO_INVOCATION_NAME,
): InstallArgs {
  const defaultPlatform = invocationName === "lazycodex" || invocationName === "lazycodex-ai" ? "codex" : undefined

  return {
    tui: options.tui !== false,
    claude: options.claude,
    openai: options.openai,
    gemini: options.gemini,
    copilot: options.copilot,
    platform: options.platform ?? defaultPlatform,
    opencodeZen: options.opencodeZen,
    zaiCodingPlan: options.zaiCodingPlan,
    kimiForCoding: options.kimiForCoding,
    opencodeGo: options.opencodeGo,
    vercelAiGateway: options.vercelAiGateway,
    codexAutonomous: options.codexAutonomous,
    skipAuth: options.skipAuth ?? false,
  }
}

export { resolveCleanupPlatform }

program
  .name("oh-my-opencode")
  .description("The ultimate OpenCode plugin - multi-model orchestration, LSP tools, and more")
  .version(VERSION, "-v, --version", "Show version number")
  .helpOption("-h, --help", "Display help for command")
  .addOption(new Option("--platform <platform>", "Install target platform: opencode, codex, both").choices(["opencode", "codex", "both"]).hideHelp())
  .enablePositionalOptions()

program
  .command("install")
  .alias("setup")
  .description("Install and configure oh-my-opencode with interactive setup")
  .option("--no-tui", "Run in non-interactive mode (requires all options)")
  .option("--claude <value>", "Claude subscription: no, yes, max20")
  .option("--openai <value>", "OpenAI/ChatGPT subscription: no, yes (default: no)")
  .option("--gemini <value>", "Gemini integration: no, yes")
  .option("--copilot <value>", "GitHub Copilot subscription: no, yes")
  .addOption(new Option("--platform <platform>", "Install target platform: opencode, codex, both").choices(["opencode", "codex", "both"]))
  .option("--opencode-zen <value>", "OpenCode Zen access: no, yes (default: no)")
  .option("--zai-coding-plan <value>", "Z.ai Coding Plan subscription: no, yes (default: no)")
  .option("--kimi-for-coding <value>", "Kimi For Coding subscription: no, yes (default: no)")
  .option("--opencode-go <value>", "OpenCode Go subscription: no, yes (default: no)")
  .option("--vercel-ai-gateway <value>", "Vercel AI Gateway: no, yes (default: no)")
  .option("--codex-autonomous", "Configure Codex with approval never, full filesystem access, and network enabled")
  .option("--no-codex-autonomous", "Leave existing Codex permission settings unchanged")
  .option("--skip-auth", "Skip authentication setup hints")
.addHelpText("after", `
Examples:
  $ bunx oh-my-opencode install
  $ npx lazycodex-ai install --no-tui
  $ bunx oh-my-opencode install --no-tui --platform=both --claude=max20 --openai=yes --gemini=yes --copilot=no
  $ omo install --platform=codex --codex-autonomous
  $ bunx oh-my-opencode install --no-tui --claude=no --gemini=no --copilot=yes --opencode-zen=yes

Model Providers (Priority: Native > Copilot > OpenCode Zen > Z.ai > Kimi > Vercel):
  Claude        Native anthropic/ models (Opus, Sonnet, Haiku)
  OpenAI        Native openai/ models (GPT-5.4 for Oracle)
  Gemini        Native google/ models (Gemini 3.1 Pro, Flash)
  Copilot       github-copilot/ models (fallback)
  OpenCode Zen  opencode/ models (opencode/claude-opus-4-7, etc.)
  Z.ai          zai-coding-plan/glm-5 (visual-engineering fallback)
  Kimi          kimi-for-coding/k2p5 (Sisyphus/Prometheus fallback)
  Vercel        vercel/ models (universal proxy, always last fallback)
`)
  .action(async (options: InstallCommandOptions) => {
    const rootOptions = program.opts<RootCommandOptions>()
    const args = resolveInstallArgs({ ...options, platform: options.platform ?? rootOptions.platform })
    const exitCode = await install(args)
    process.exit(exitCode)
  })

configureCleanupCommand(program)

program
   .command("run <message>")
   .allowUnknownOption()
   .passThroughOptions()
  .description("Run opencode with todo/background task completion enforcement")
  .option("-a, --agent <name>", "Agent to use (default: from CLI/env/config, fallback: Sisyphus)")
  .option("-m, --model <provider/model>", "Model override (e.g., anthropic/claude-sonnet-4)")
  .option("-d, --directory <path>", "Working directory")
  .option("-p, --port <port>", "Server port (attaches if port already in use)", parseInt)
  .option("--attach <url>", "Attach to existing opencode server URL")
  .option("--on-complete <command>", "Shell command to run after completion")
  .option("--json", "Output structured JSON result to stdout")
  .option("--no-timestamp", "Disable timestamp prefix in run output")
  .option("--verbose", "Show full event stream (default: messages/tools only)")
  .option("--session-id <id>", "Resume existing session instead of creating new one")
  .addHelpText("after", `
Examples:
  $ bunx oh-my-opencode run "Fix the bug in index.ts"
  $ bunx oh-my-opencode run --agent Sisyphus "Implement feature X"
  $ bunx oh-my-opencode run --port 4321 "Fix the bug"
  $ bunx oh-my-opencode run --attach http://127.0.0.1:4321 "Fix the bug"
  $ bunx oh-my-opencode run --json "Fix the bug" | jq .sessionId
  $ bunx oh-my-opencode run --on-complete "notify-send Done" "Fix the bug"
  $ bunx oh-my-opencode run --session-id ses_abc123 "Continue the work"
  $ bunx oh-my-opencode run --model anthropic/claude-sonnet-4 "Fix the bug"
  $ bunx oh-my-opencode run --agent Sisyphus --model openai/gpt-5.5 "Implement feature X"

Agent resolution order:
  1) --agent flag
  2) OPENCODE_DEFAULT_AGENT
  3) oh-my-opencode.json "default_run_agent"
  4) Sisyphus (fallback)

Available core agents:
  Sisyphus, Hephaestus, Prometheus, Atlas

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
      model: options.model,
      directory: options.directory,
      port: options.port,
      attach: options.attach,
      onComplete: options.onComplete,
      json: options.json ?? false,
      timestamp: options.timestamp ?? true,
      verbose: options.verbose ?? false,
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
  .option("--status", "Show compact system dashboard")
  .option("--verbose", "Show detailed diagnostic information")
  .option("--json", "Output results in JSON format")
  .addHelpText("after", `
Examples:
  $ bunx oh-my-opencode doctor            # Show problems only
  $ bunx oh-my-opencode doctor --status   # Compact dashboard
  $ bunx oh-my-opencode doctor --verbose  # Deep diagnostics
  $ bunx oh-my-opencode doctor --json     # JSON output
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
  .command("refresh-model-capabilities")
  .description("Refresh the cached models.dev-based model capabilities snapshot")
  .option("-d, --directory <path>", "Working directory to read oh-my-opencode config from")
  .option("--source-url <url>", "Override the models.dev source URL")
  .option("--json", "Output refresh summary as JSON")
  .action(async (options) => {
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
    console.log(`oh-my-opencode v${VERSION}`)
  })

program
  .command("boulder")
  .description("Show boulder progress, elapsed time, and per-task statistics")
  .option("-d, --directory <path>", "Working directory")
  .option("-w, --work-id <id>", "Filter to a specific work")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const exitCode = await boulder({
      directory: options.directory,
      workId: options.workId,
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

program.addCommand(createMcpOAuthCommand())

export function runCli(): void {
  program.parse()
}
