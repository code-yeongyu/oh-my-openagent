#!/usr/bin/env bun
import { Command } from "commander"
import { install } from "./install"
import type { InstallArgs } from "./types"

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
  .command("version")
  .description("Show version information")
  .action(() => {
    console.log(`oh-my-opencode v${VERSION}`)
  })

program.parse()
