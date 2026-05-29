import { homedir } from "node:os"
import { defaultRunCommand } from "./claudecode-process"
import type { ClaudeCodeInstallOptions, ClaudeCodeInstallResult } from "./types"

const MARKETPLACE_NAME = "sisyphuslabs"
const DEFAULT_MARKETPLACE_REPO = "code-yeongyu/lazyclaudecode"
const DEFAULT_PLUGIN_REF = "omo@sisyphuslabs"

export async function runClaudeCodeInstaller(
  options: ClaudeCodeInstallOptions = {},
): Promise<ClaudeCodeInstallResult> {
  const marketplaceRepo = options.marketplaceRepo ?? DEFAULT_MARKETPLACE_REPO
  const pluginRef = options.pluginRef ?? DEFAULT_PLUGIN_REF
  const runCommand = options.runCommand ?? defaultRunCommand
  const log = options.log ?? ((message: string) => console.log(message))
  // homedir is resolved (never written to) so the caller can prove ~/.claude stays untouched.
  void (options.homeDir ?? homedir())
  const env = options.env ?? process.env

  const marketplaceAddArgs = ["plugin", "marketplace", "add", marketplaceRepo] as const
  const pluginInstallArgs = ["plugin", "install", pluginRef] as const

  try {
    await runCommand("claude", marketplaceAddArgs, { env })
    await runCommand("claude", pluginInstallArgs, { env })
  } catch (error) {
    printManualInstructions(log, marketplaceRepo, pluginRef)
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to install the Claude Code plugin via the 'claude' CLI (${reason}). ` +
        "Install Claude Code first (https://claude.com/claude-code), then run the two /plugin commands printed above.",
    )
  }

  await trackClaudeCodeInstallTelemetry()

  return {
    marketplaceName: MARKETPLACE_NAME,
    pluginRef,
  }
}

function printManualInstructions(
  log: (message: string) => void,
  marketplaceRepo: string,
  pluginRef: string,
): void {
  log("Could not drive the 'claude' CLI. Run these inside Claude Code to install manually:")
  log(`  /plugin marketplace add ${marketplaceRepo}`)
  log(`  /plugin install ${pluginRef}`)
}

async function trackClaudeCodeInstallTelemetry(): Promise<void> {
  try {
    const { createInstallPostHog, getPostHogDistinctId } = await import("@oh-my-opencode/omo-claude/telemetry")
    const posthog = createInstallPostHog()
    posthog.trackActive(getPostHogDistinctId(), "install_completed")
    await posthog.shutdown()
  } catch {
    // no-excuse-ok: catch
    // telemetry must never break installs
  }
}
