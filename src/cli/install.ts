import * as p from "@clack/prompts"
import color from "picocolors"
import type { InstallArgs, InstallConfig, ClaudeSubscription, BooleanArg, DetectedConfig } from "./types"
import {
  addPluginToOpenCodeConfig,
  writeOmoConfig,
  isOpenCodeInstalled,
  getOpenCodeVersion,
  addAuthPlugins,
  setupChatGPTHotfix,
  runBunInstall,
  addProviderConfig,
  detectCurrentConfig,
} from "./config-manager"

const SYMBOLS = {
  check: color.green("✓"),
  cross: color.red("✗"),
  arrow: color.cyan("→"),
  bullet: color.dim("•"),
  info: color.blue("ℹ"),
  warn: color.yellow("⚠"),
  star: color.yellow("★"),
}

function formatProvider(name: string, enabled: boolean, detail?: string): string {
  const status = enabled ? SYMBOLS.check : color.dim("○")
  const label = enabled ? color.white(name) : color.dim(name)
  const suffix = detail ? color.dim(` (${detail})`) : ""
  return `  ${status} ${label}${suffix}`
}

function formatConfigSummary(config: InstallConfig): string {
  const lines: string[] = []

  lines.push(color.bold(color.white("Configuration Summary")))
  lines.push("")

  const claudeDetail = config.hasClaude ? (config.isMax20 ? "max20" : "standard") : undefined
  lines.push(formatProvider("Claude", config.hasClaude, claudeDetail))
  lines.push(formatProvider("ChatGPT", config.hasChatGPT))
  lines.push(formatProvider("Gemini", config.hasGemini))

  lines.push("")
  lines.push(color.dim("─".repeat(40)))
  lines.push("")

  lines.push(color.bold(color.white("Agent Configuration")))
  lines.push("")

  const sisyphusModel = config.hasClaude ? "claude-opus-4-5" : "big-pickle"
  const oracleModel = config.hasChatGPT ? "gpt-5.2" : (config.hasClaude ? "claude-opus-4-5" : "big-pickle")
  const librarianModel = config.hasClaude && config.isMax20 ? "claude-sonnet-4-5" : "big-pickle"
  const frontendModel = config.hasGemini ? "gemini-3-pro-high" : (config.hasClaude ? "claude-opus-4-5" : "big-pickle")

  lines.push(`  ${SYMBOLS.bullet} Sisyphus     ${SYMBOLS.arrow} ${color.cyan(sisyphusModel)}`)
  lines.push(`  ${SYMBOLS.bullet} Oracle       ${SYMBOLS.arrow} ${color.cyan(oracleModel)}`)
  lines.push(`  ${SYMBOLS.bullet} Librarian    ${SYMBOLS.arrow} ${color.cyan(librarianModel)}`)
  lines.push(`  ${SYMBOLS.bullet} Frontend     ${SYMBOLS.arrow} ${color.cyan(frontendModel)}`)

  return lines.join("\n")
}

function printHeader(isUpdate: boolean): void {
  const mode = isUpdate ? "Update" : "Install"
  console.log()
  console.log(color.bgMagenta(color.white(` oMoMoMoMo... ${mode} `)))
  console.log()
}

function printStep(step: number, total: number, message: string): void {
  const progress = color.dim(`[${step}/${total}]`)
  console.log(`${progress} ${message}`)
}

function printSuccess(message: string): void {
  console.log(`${SYMBOLS.check} ${message}`)
}

function printError(message: string): void {
  console.log(`${SYMBOLS.cross} ${color.red(message)}`)
}

function printInfo(message: string): void {
  console.log(`${SYMBOLS.info} ${message}`)
}

function printWarning(message: string): void {
  console.log(`${SYMBOLS.warn} ${color.yellow(message)}`)
}

function printBox(content: string, title?: string): void {
  const lines = content.split("\n")
  const maxWidth = Math.max(...lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, "").length), title?.length ?? 0) + 4
  const border = color.dim("─".repeat(maxWidth))

  console.log()
  if (title) {
    console.log(color.dim("┌─") + color.bold(` ${title} `) + color.dim("─".repeat(maxWidth - title.length - 4)) + color.dim("┐"))
  } else {
    console.log(color.dim("┌") + border + color.dim("┐"))
  }

  for (const line of lines) {
    const stripped = line.replace(/\x1b\[[0-9;]*m/g, "")
    const padding = maxWidth - stripped.length
    console.log(color.dim("│") + ` ${line}${" ".repeat(padding - 1)}` + color.dim("│"))
  }

  console.log(color.dim("└") + border + color.dim("┘"))
  console.log()
}

function validateNonTuiArgs(args: InstallArgs): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (args.claude === undefined) {
    errors.push("--claude is required (values: no, yes, max20)")
  } else if (!["no", "yes", "max20"].includes(args.claude)) {
    errors.push(`Invalid --claude value: ${args.claude} (expected: no, yes, max20)`)
  }

  if (args.chatgpt === undefined) {
    errors.push("--chatgpt is required (values: no, yes)")
  } else if (!["no", "yes"].includes(args.chatgpt)) {
    errors.push(`Invalid --chatgpt value: ${args.chatgpt} (expected: no, yes)`)
  }

  if (args.gemini === undefined) {
    errors.push("--gemini is required (values: no, yes)")
  } else if (!["no", "yes"].includes(args.gemini)) {
    errors.push(`Invalid --gemini value: ${args.gemini} (expected: no, yes)`)
  }

  return { valid: errors.length === 0, errors }
}

function argsToConfig(args: InstallArgs): InstallConfig {
  return {
    hasClaude: args.claude !== "no",
    isMax20: args.claude === "max20",
    hasChatGPT: args.chatgpt === "yes",
    hasGemini: args.gemini === "yes",
  }
}

function detectedToInitialValues(detected: DetectedConfig): { claude: ClaudeSubscription; chatgpt: BooleanArg; gemini: BooleanArg } {
  let claude: ClaudeSubscription = "no"
  if (detected.hasClaude) {
    claude = detected.isMax20 ? "max20" : "yes"
  }

  return {
    claude,
    chatgpt: detected.hasChatGPT ? "yes" : "no",
    gemini: detected.hasGemini ? "yes" : "no",
  }
}

async function runTuiMode(detected: DetectedConfig): Promise<InstallConfig | null> {
  const initial = detectedToInitialValues(detected)

  const claude = await p.select({
    message: "Do you have a Claude Pro/Max subscription?",
    options: [
      { value: "no" as const, label: "No", hint: "Will use opencode/big-pickle as fallback" },
      { value: "yes" as const, label: "Yes (standard)", hint: "Claude Opus 4.5 for orchestration" },
      { value: "max20" as const, label: "Yes (max20 mode)", hint: "Full power with Claude Sonnet 4.5 for Librarian" },
    ],
    initialValue: initial.claude,
  })

  if (p.isCancel(claude)) {
    p.cancel("Installation cancelled.")
    return null
  }

  const chatgpt = await p.select({
    message: "Do you have a ChatGPT Plus/Pro subscription?",
    options: [
      { value: "no" as const, label: "No", hint: "Oracle will use fallback model" },
      { value: "yes" as const, label: "Yes", hint: "GPT-5.2 for debugging and architecture" },
    ],
    initialValue: initial.chatgpt,
  })

  if (p.isCancel(chatgpt)) {
    p.cancel("Installation cancelled.")
    return null
  }

  const gemini = await p.select({
    message: "Will you integrate Google Gemini?",
    options: [
      { value: "no" as const, label: "No", hint: "Frontend/docs agents will use fallback" },
      { value: "yes" as const, label: "Yes", hint: "Beautiful UI generation with Gemini 3 Pro" },
    ],
    initialValue: initial.gemini,
  })

  if (p.isCancel(gemini)) {
    p.cancel("Installation cancelled.")
    return null
  }

  return {
    hasClaude: claude !== "no",
    isMax20: claude === "max20",
    hasChatGPT: chatgpt === "yes",
    hasGemini: gemini === "yes",
  }
}

async function runNonTuiInstall(args: InstallArgs): Promise<number> {
  const validation = validateNonTuiArgs(args)
  if (!validation.valid) {
    printHeader(false)
    printError("Validation failed:")
    for (const err of validation.errors) {
      console.log(`  ${SYMBOLS.bullet} ${err}`)
    }
    console.log()
    printInfo("Usage: bunx oh-my-opencode install --no-tui --claude=<no|yes|max20> --chatgpt=<no|yes> --gemini=<no|yes>")
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
  if (!installed) {
    printError("OpenCode is not installed on this system.")
    printInfo("Visit https://opencode.ai/docs for installation instructions")
    return 1
  }

  const version = await getOpenCodeVersion()
  printSuccess(`OpenCode ${version ?? ""} detected`)

  if (isUpdate) {
    const initial = detectedToInitialValues(detected)
    printInfo(`Current config: Claude=${initial.claude}, ChatGPT=${initial.chatgpt}, Gemini=${initial.gemini}`)
  }

  const config = argsToConfig(args)

  printStep(step++, totalSteps, "Adding oh-my-opencode plugin...")
  const pluginResult = addPluginToOpenCodeConfig()
  if (!pluginResult.success) {
    printError(`Failed: ${pluginResult.error}`)
    return 1
  }
  printSuccess(`Plugin ${isUpdate ? "verified" : "added"} ${SYMBOLS.arrow} ${color.dim(pluginResult.configPath)}`)

  if (config.hasGemini || config.hasChatGPT) {
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

  if (config.hasChatGPT) {
    printStep(step++, totalSteps, "Setting up ChatGPT hotfix...")
    const hotfixResult = setupChatGPTHotfix()
    if (!hotfixResult.success) {
      printError(`Failed: ${hotfixResult.error}`)
      return 1
    }
    printSuccess(`Hotfix configured ${SYMBOLS.arrow} ${color.dim(hotfixResult.configPath)}`)

    printInfo("Installing dependencies with bun...")
    const bunSuccess = await runBunInstall()
    if (bunSuccess) {
      printSuccess("Dependencies installed")
    } else {
      printWarning("bun install failed - run manually: cd ~/.config/opencode && bun i")
    }
  } else {
    step++
  }

  printStep(step++, totalSteps, "Writing oh-my-opencode configuration...")
  const omoResult = writeOmoConfig(config)
  if (!omoResult.success) {
    printError(`Failed: ${omoResult.error}`)
    return 1
  }
  printSuccess(`Config written ${SYMBOLS.arrow} ${color.dim(omoResult.configPath)}`)

  printBox(formatConfigSummary(config), isUpdate ? "Updated Configuration" : "Installation Complete")

  if (!config.hasClaude && !config.hasChatGPT && !config.hasGemini) {
    printWarning("No model providers configured. Using opencode/big-pickle as fallback.")
  }

  if ((config.hasClaude || config.hasChatGPT || config.hasGemini) && !args.skipAuth) {
    console.log(color.bold("Next Steps - Authenticate your providers:"))
    console.log()
    if (config.hasClaude) {
      console.log(`  ${SYMBOLS.arrow} ${color.dim("opencode auth login")} ${color.gray("(select Anthropic → Claude Pro/Max)")}`)
    }
    if (config.hasChatGPT) {
      console.log(`  ${SYMBOLS.arrow} ${color.dim("opencode auth login")} ${color.gray("(select OpenAI → ChatGPT Plus/Pro)")}`)
    }
    if (config.hasGemini) {
      console.log(`  ${SYMBOLS.arrow} ${color.dim("opencode auth login")} ${color.gray("(select Google → OAuth with Antigravity)")}`)
    }
    console.log()
  }

  console.log(`${SYMBOLS.star} ${color.bold(color.green(isUpdate ? "Configuration updated!" : "Installation complete!"))}`)
  console.log(`  Run ${color.cyan("opencode")} to start!`)
  console.log()
  console.log(color.dim("oMoMoMoMo... Enjoy!"))
  console.log()

  return 0
}

export async function install(args: InstallArgs): Promise<number> {
  if (!args.tui) {
    return runNonTuiInstall(args)
  }

  const detected = detectCurrentConfig()
  const isUpdate = detected.isInstalled

  p.intro(color.bgMagenta(color.white(isUpdate ? " oMoMoMoMo... Update " : " oMoMoMoMo... ")))

  if (isUpdate) {
    const initial = detectedToInitialValues(detected)
    p.log.info(`Existing configuration detected: Claude=${initial.claude}, ChatGPT=${initial.chatgpt}, Gemini=${initial.gemini}`)
  }

  const s = p.spinner()
  s.start("Checking OpenCode installation")

  const installed = await isOpenCodeInstalled()
  if (!installed) {
    s.stop("OpenCode is not installed")
    p.log.error("OpenCode is not installed on this system.")
    p.note("Visit https://opencode.ai/docs for installation instructions", "Installation Guide")
    p.outro(color.red("Please install OpenCode first."))
    return 1
  }

  const version = await getOpenCodeVersion()
  s.stop(`OpenCode ${version ?? "installed"} ${color.green("✓")}`)

  const config = await runTuiMode(detected)
  if (!config) return 1

  s.start("Adding oh-my-opencode to OpenCode config")
  const pluginResult = addPluginToOpenCodeConfig()
  if (!pluginResult.success) {
    s.stop(`Failed to add plugin: ${pluginResult.error}`)
    p.outro(color.red("Installation failed."))
    return 1
  }
  s.stop(`Plugin added to ${color.cyan(pluginResult.configPath)}`)

  if (config.hasGemini || config.hasChatGPT) {
    s.start("Adding auth plugins (fetching latest versions)")
    const authResult = await addAuthPlugins(config)
    if (!authResult.success) {
      s.stop(`Failed to add auth plugins: ${authResult.error}`)
      p.outro(color.red("Installation failed."))
      return 1
    }
    s.stop(`Auth plugins added to ${color.cyan(authResult.configPath)}`)

    s.start("Adding provider configurations")
    const providerResult = addProviderConfig(config)
    if (!providerResult.success) {
      s.stop(`Failed to add provider config: ${providerResult.error}`)
      p.outro(color.red("Installation failed."))
      return 1
    }
    s.stop(`Provider config added to ${color.cyan(providerResult.configPath)}`)
  }

  if (config.hasChatGPT) {
    s.start("Setting up ChatGPT hotfix")
    const hotfixResult = setupChatGPTHotfix()
    if (!hotfixResult.success) {
      s.stop(`Failed to setup hotfix: ${hotfixResult.error}`)
      p.outro(color.red("Installation failed."))
      return 1
    }
    s.stop(`Hotfix configured in ${color.cyan(hotfixResult.configPath)}`)

    s.start("Installing dependencies with bun")
    const bunSuccess = await runBunInstall()
    if (bunSuccess) {
      s.stop("Dependencies installed")
    } else {
      s.stop(color.yellow("bun install failed - run manually: cd ~/.config/opencode && bun i"))
    }
  }

  s.start("Writing oh-my-opencode configuration")
  const omoResult = writeOmoConfig(config)
  if (!omoResult.success) {
    s.stop(`Failed to write config: ${omoResult.error}`)
    p.outro(color.red("Installation failed."))
    return 1
  }
  s.stop(`Config written to ${color.cyan(omoResult.configPath)}`)

  if (!config.hasClaude && !config.hasChatGPT && !config.hasGemini) {
    p.log.warn("No model providers configured. Using opencode/big-pickle as fallback.")
  }

  p.note(formatConfigSummary(config), isUpdate ? "Updated Configuration" : "Installation Complete")

  if ((config.hasClaude || config.hasChatGPT || config.hasGemini) && !args.skipAuth) {
    const steps: string[] = []
    if (config.hasClaude) {
      steps.push(`${color.dim("opencode auth login")} ${color.gray("(select Anthropic → Claude Pro/Max)")}`)
    }
    if (config.hasChatGPT) {
      steps.push(`${color.dim("opencode auth login")} ${color.gray("(select OpenAI → ChatGPT Plus/Pro)")}`)
    }
    if (config.hasGemini) {
      steps.push(`${color.dim("opencode auth login")} ${color.gray("(select Google → OAuth with Antigravity)")}`)
    }
    p.note(steps.join("\n"), "Next Steps - Authenticate your providers")
  }

  p.log.success(color.bold(isUpdate ? "Configuration updated!" : "Installation complete!"))
  p.log.message(`Run ${color.cyan("opencode")} to start!`)

  p.outro(color.green("oMoMoMoMo... Enjoy!"))

  return 0
}
