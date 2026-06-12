import { createInterface } from "node:readline/promises"
import color from "picocolors"
import { PLUGIN_NAME, PUBLISHED_PACKAGE_NAME } from "../shared"
import type { InstallArgs, InstallPlatform } from "./types"
import {
  addPluginToOpenCodeConfig,
  detectCurrentConfig,
  getOpenCodeVersion,
  isOpenCodeInstalled,
  writeOmoConfig,
} from "./config-manager"
import {
  SYMBOLS,
  argsToConfig,
  detectedToInitialValues,
  formatConfigSummary,
  printBox,
  printError,
  printHeader,
  printInfo,
  printStep,
  printSuccess,
  printWarning,
  validateNonTuiArgs,
} from "./install-validators"
import { getUnsupportedOpenCodeVersionMessage } from "./minimum-opencode-version"
import { runCodexInstaller } from "./install-codex"
import { starGitHubRepositories } from "./star-request"
import { getNoModelProvidersWarning, hasAnyConfiguredProvider } from "./provider-availability"

export async function runCliInstaller(args: InstallArgs, version: string): Promise<number> {
  const validation = validateNonTuiArgs(args)
  if (!validation.valid) {
    printHeader(false)
    printError("Validation failed:")
    for (const err of validation.errors) {
      console.log(`  ${SYMBOLS.bullet} ${err}`)
    }
    console.log()
    printInfo(
      `Usage: bunx ${PUBLISHED_PACKAGE_NAME} install --no-tui --claude=<no|yes|max20> --gemini=<no|yes> --copilot=<no|yes>`,
    )
    console.log()
    return 1
  }

  const config = argsToConfig(args)
  const hasOpenCode = config.hasOpenCode
  const detected = hasOpenCode
    ? detectCurrentConfig()
    : {
        isInstalled: false,
        installedVersion: null,
        hasClaude: false,
        isMax20: false,
        hasOpenAI: false,
        hasGemini: false,
        hasCopilot: false,
        hasCodex: false,
        hasOpencodeZen: false,
        hasZaiCodingPlan: false,
        hasKimiForCoding: false,
        hasOpencodeGo: false,
        hasBailianCodingPlan: false,
        hasMinimaxCnCodingPlan: false,
        hasMinimaxCodingPlan: false,
        hasVercelAiGateway: false,
      }
  const isUpdate = hasOpenCode && detected.isInstalled

  printHeader(isUpdate)

  const totalSteps = hasOpenCode ? 4 : 2
  let step = 1

  if (hasOpenCode) {
    printStep(step++, totalSteps, "Checking OpenCode installation...")
    const installed = await isOpenCodeInstalled()
    const openCodeVersion = await getOpenCodeVersion()
    if (!installed) {
      printWarning(
        "OpenCode binary not found. Plugin will be configured, but you'll need to install OpenCode to use it.",
      )
      printInfo("Visit https://opencode.ai/docs for installation instructions")
    } else {
      printSuccess(`OpenCode ${openCodeVersion ?? ""} detected`)

      const unsupportedVersionMessage = getUnsupportedOpenCodeVersionMessage(openCodeVersion)
      if (unsupportedVersionMessage) {
        printWarning(unsupportedVersionMessage)
        return 1
      }
    }
  }

  if (isUpdate) {
    const initial = detectedToInitialValues(detected)
    printInfo(`Current config: Claude=${initial.claude}, Gemini=${initial.gemini}`)
  }

  if (hasOpenCode) {
    printStep(step++, totalSteps, `Adding ${PLUGIN_NAME} plugin...`)
    const pluginResult = await addPluginToOpenCodeConfig(version)
    if (!pluginResult.success) {
      printError(`Failed: ${pluginResult.error}`)
      return 1
    }
    printSuccess(
      `Plugin ${isUpdate ? "verified" : "added"} ${SYMBOLS.arrow} ${color.dim(pluginResult.configPath)}`,
    )

    printStep(step++, totalSteps, `Writing ${PLUGIN_NAME} configuration...`)
    const omoResult = writeOmoConfig(config)
    if (!omoResult.success) {
      printError(`Failed: ${omoResult.error}`)
      return 1
    }
    printSuccess(`Config written ${SYMBOLS.arrow} ${color.dim(omoResult.configPath)}`)
  }

  printBox(formatConfigSummary(config), isUpdate ? "Updated Configuration" : "Installation Complete")

  if (config.hasOpenCode && !config.hasClaude) {
    printInfo(
      "Note: Sisyphus agent performs best with Claude Opus 4.5+. " +
        "Other models work but may have reduced orchestration quality.",
    )
  }

  if (config.hasOpenCode && !hasAnyConfiguredProvider(config)) {
    printWarning(getNoModelProvidersWarning())
  }

  console.log(`${SYMBOLS.star} ${color.bold(color.green(isUpdate ? "Configuration updated!" : "Installation complete!"))}`)
  if (hasOpenCode) {
    console.log(`  Run ${color.cyan("opencode")} to start!`)
  }
  console.log()

  if (config.hasCodex) {
    printInfo("Installing Codex harness adapter...")
    try {
      const codexResult = await runCodexInstaller({ autonomousPermissions: config.codexAutonomous })
      printSuccess(`Codex plugin installed ${SYMBOLS.arrow} ${color.dim(codexResult.configPath)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!config.hasOpenCode) {
        printError(`Codex install failed: ${message}`)
        return 1
      }
      printWarning(`Codex install failed (OpenCode install is still complete): ${message}`)
    }
    console.log()
  }

  printInfo(
    "Anonymous telemetry is enabled by default. Disable it with OMO_SEND_ANONYMOUS_TELEMETRY=0 or OMO_DISABLE_POSTHOG=1.",
  )
  printInfo("Docs: docs/legal/privacy-policy.md and docs/legal/terms-of-service.md")
  console.log()

  printBox(
    `${color.bold("Pro Tip:")} Include ${color.cyan("ultrawork")} (or ${color.cyan("ulw")}) in your prompt.\n` +
      `All features work like magic-parallel agents, background tasks,\n` +
      `deep exploration, and relentless execution until completion.`,
    "The Magic Word",
  )

  if (args.tui) {
    await maybePromptForGitHubStars(config.platform)
  }
  console.log(color.dim("oMoMoMoMo... Enjoy!"))
  console.log()

  if (hasOpenCode && (config.hasClaude || config.hasGemini || config.hasCopilot) && !args.skipAuth) {
    printBox(
      `Run ${color.cyan("opencode auth login")} and select your provider:\n` +
        (config.hasClaude ? `  ${SYMBOLS.bullet} Anthropic ${color.gray("→ Claude Pro/Max")}\n` : "") +
        (config.hasGemini ? `  ${SYMBOLS.bullet} Google ${color.gray("→ Gemini")}\n` : "") +
        (config.hasCopilot ? `  ${SYMBOLS.bullet} GitHub ${color.gray("→ Copilot")}` : ""),
      "Authenticate Your Providers",
    )
  }

  return 0
}

async function maybePromptForGitHubStars(platform: InstallPlatform): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return

  const readline = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await readline.question(`${SYMBOLS.star} ${color.yellow("Star the repos on GitHub?")} ${color.dim("[y/N]")} `)
    if (!isYes(answer)) return
  } finally {
    readline.close()
  }

  const results = await starGitHubRepositories(platform)
  const failed = results.filter((result) => !result.ok)
  if (failed.length === 0) {
    printSuccess("Starred GitHub repositories")
    console.log()
    return
  }

  printWarning("Could not star every repository. Make sure GitHub CLI is installed and authenticated.")
  for (const result of failed) {
    console.log(`  ${SYMBOLS.bullet} ${result.repository}`)
  }
  console.log()
}

function isYes(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized === "y" || normalized === "yes"
}
