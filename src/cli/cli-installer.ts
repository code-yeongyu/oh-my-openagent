import color from "picocolors"
import type { InstallArgs } from "./types"
import {
  addAuthPlugins,
  addPluginToOpenCodeConfig,
  addProviderConfig,
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
      "Usage: bunx oh-my-opencode install --no-tui --claude=<no|yes|max20> --gemini=<no|yes> --copilot=<no|yes>",
    )
    console.log()
    return 1
  }

  const detected = detectCurrentConfig()
  const isUpdate = detected.isInstalled

  printHeader(isUpdate)

  const totalSteps = 6
  let step = 1

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
  }

  if (isUpdate) {
    const initial = detectedToInitialValues(detected)
    printInfo(`Current config: Claude=${initial.claude}, Gemini=${initial.gemini}`)
  }

  const config = argsToConfig(args)

  printStep(step++, totalSteps, "Adding oh-my-opencode plugin...")
  const pluginResult = await addPluginToOpenCodeConfig(version)
  if (!pluginResult.success) {
    printError(`Failed: ${pluginResult.error}`)
    return 1
  }
  printSuccess(
    `Plugin ${isUpdate ? "verified" : "added"} ${SYMBOLS.arrow} ${color.dim(pluginResult.configPath)}`,
  )

  if (config.hasGemini) {
    printStep(step++, totalSteps, "Adding auth plugins...")
    const authResult = await addAuthPlugins(config)
    if (!authResult.success) {
      printError(`Failed: ${authResult.error}`)
      return 1
    }
    printSuccess(`Auth plugins configured ${SYMBOLS.arrow} ${color.dim(authResult.configPath)}`)

    printStep(step++, totalSteps, "Adding provider configurations...")
    const providerResult = addProviderConfig(config)
    if (!providerResult.success) {
      printError(`Failed: ${providerResult.error}`)
      return 1
    }
    printSuccess(`Providers configured ${SYMBOLS.arrow} ${color.dim(providerResult.configPath)}`)
  } else {
    step += 2
  }

  printStep(step++, totalSteps, "Writing oh-my-opencode configuration...")
  const omoResult = writeOmoConfig(config)
  if (!omoResult.success) {
    printError(`Failed: ${omoResult.error}`)
    return 1
  }
  printSuccess(`Config written ${SYMBOLS.arrow} ${color.dim(omoResult.configPath)}`)

  printBox(formatConfigSummary(config), isUpdate ? "Updated Configuration" : "Installation Complete")

  if (!config.hasClaude) {
    console.log()
    console.log(color.bgRed(color.white(color.bold(" CRITICAL WARNING "))))
    console.log()
    console.log(color.red(color.bold("  Sisyphus agent is STRONGLY optimized for Claude Opus 4.5.")))
    console.log(color.red("  Without Claude, you may experience significantly degraded performance:"))
    console.log(color.dim("    • Reduced orchestration quality"))
    console.log(color.dim("    • Weaker tool selection and delegation"))
    console.log(color.dim("    • Less reliable task completion"))
    console.log()
    console.log(color.yellow("  Consider subscribing to Claude Pro/Max for the best experience."))
    console.log()
  }

  if (
    !config.hasClaude &&
    !config.hasOpenAI &&
    !config.hasGemini &&
    !config.hasCopilot &&
    !config.hasOpencodeZen
  ) {
    printWarning("No model providers configured. Using opencode/glm-4.7-free as fallback.")
  }

  console.log(`${SYMBOLS.star} ${color.bold(color.green(isUpdate ? "Configuration updated!" : "Installation complete!"))}`)
  console.log(`  Run ${color.cyan("opencode")} to start!`)
  console.log()

  printBox(
    `${color.bold("Pro Tip:")} Include ${color.cyan("ultrawork")} (or ${color.cyan("ulw")}) in your prompt.\n` +
      `All features work like magic—parallel agents, background tasks,\n` +
      `deep exploration, and relentless execution until completion.`,
    "The Magic Word",
  )

  console.log(`${SYMBOLS.star} ${color.yellow("If you found this helpful, consider starring the repo!")}`)
  console.log(
    `  ${color.dim("gh api --silent --method PUT /user/starred/code-yeongyu/oh-my-opencode >/dev/null 2>&1 || true")}`,
  )
  console.log()
  console.log(color.dim("oMoMoMoMo... Enjoy!"))
  console.log()

  if ((config.hasClaude || config.hasGemini || config.hasCopilot) && !args.skipAuth) {
    printBox(
      `Run ${color.cyan("opencode auth login")} and select your provider:\n` +
        (config.hasClaude ? `  ${SYMBOLS.bullet} Anthropic ${color.gray("→ Claude Pro/Max")}\n` : "") +
        (config.hasGemini ? `  ${SYMBOLS.bullet} Google ${color.gray("→ OAuth with Antigravity")}\n` : "") +
        (config.hasCopilot ? `  ${SYMBOLS.bullet} GitHub ${color.gray("→ Copilot")}` : ""),
      "Authenticate Your Providers",
    )
  }

  return 0
}
