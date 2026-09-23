import * as p from "@clack/prompts"
import color from "picocolors"
import { PLUGIN_NAME } from "../shared"
import type { InstallArgs } from "./types"
import {
  addPluginToOpenCodeConfig,
  detectCurrentConfig,
  getOpenCodeVersion,
  isOpenCodeInstalled,
  writeOmoConfig,
} from "./config-manager"
import { detectedToInitialValues, formatConfigSummary, SYMBOLS } from "./install-validators"
import { getUnsupportedOpenCodeVersionMessage } from "./minimum-opencode-version"
import { promptInstallConfig, promptInstallPlatform } from "./tui-install-prompts"
import { detectCodexInstallation, formatCodexInstallationWarning, runCodexInstaller } from "./install-codex"
import { runNativeDevInstaller } from "./install-native-dev"
import { nativeInstallFailureLines, nativeInstallSuccessLine, runNativeInstall } from "./install-native"
import { NATIVE_EDITION_HINT_TITLE, nativeEditionHintLines, shouldShowNativeEditionHint } from "./native-edition-hint"
import { starGitHubRepositories } from "./star-request"
import { getNoModelProvidersWarning, hasAnyConfiguredProvider } from "./provider-availability"
import { ensureTuiPluginEntry } from "./config-manager/add-tui-plugin-to-tui-config"
import * as astGrepInstall from "./install-ast-grep-sg"

export async function runTuiInstaller(args: InstallArgs, version: string): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("Error: Interactive installer requires a TTY. Use --non-interactive or set environment variables directly.")
    return 1
  }

  const selectedPlatform = await promptInstallPlatform(args.platform ?? "opencode")
  if (!selectedPlatform) return 1

  const hasOpenCode = selectedPlatform === "opencode" || selectedPlatform === "both"
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

  p.intro(color.bgMagenta(color.white(isUpdate ? " oMoMoMoMo... Update " : " oMoMoMoMo... ")))

  if (isUpdate) {
    const initial = detectedToInitialValues(detected)
    p.log.info(`Existing configuration detected: Claude=${initial.claude}, Gemini=${initial.gemini}`)
  }

  const spinner = p.spinner()
  if (hasOpenCode) {
    spinner.start("Checking OpenCode installation")

    const installed = await isOpenCodeInstalled()
    const openCodeVersion = await getOpenCodeVersion()
    if (!installed) {
      spinner.stop(`OpenCode binary not found ${color.yellow("[!]")}`)
      p.log.warn("OpenCode binary not found. Plugin will be configured, but you'll need to install OpenCode to use it.")
      p.note("Visit https://opencode.ai/docs for installation instructions", "Installation Guide")
    } else {
      spinner.stop(`OpenCode ${openCodeVersion ?? "installed"} ${color.green("[OK]")}`)

      const unsupportedVersionMessage = getUnsupportedOpenCodeVersionMessage(openCodeVersion)
      if (unsupportedVersionMessage) {
        p.log.warn(unsupportedVersionMessage)
        p.outro(color.red("Installation blocked."))
        return 1
      }
    }
  }

  const config = await promptInstallConfig(detected, selectedPlatform, args.codexAutonomous)
  if (!config) return 1

  if (config.hasOpenCode) {
    spinner.start(`Adding ${PLUGIN_NAME} to OpenCode config`)
    const pluginResult = await addPluginToOpenCodeConfig(version)
    if (!pluginResult.success) {
      spinner.stop(`Failed to add plugin: ${pluginResult.error}`)
      p.outro(color.red("Installation failed."))
      return 1
    }
    spinner.stop(`Plugin added to ${color.cyan(pluginResult.configPath)}`)
    try {
      ensureTuiPluginEntry()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      p.log.warn(`Could not update OpenCode TUI config: ${message}`)
    }

    spinner.start(`Writing ${PLUGIN_NAME} configuration`)
    const omoResult = writeOmoConfig(config)
    if (!omoResult.success) {
      spinner.stop(`Failed to write config: ${omoResult.error}`)
      p.outro(color.red("Installation failed."))
      return 1
    }
    spinner.stop(`Config written to ${color.cyan(omoResult.configPath)}`)
    await astGrepInstall.installAstGrepForOpenCode({ log: p.log.warn })
  }

  if (config.hasOpenCode && !config.hasClaude) {
    p.log.info(
      `${color.bold("Note:")} Sisyphus agent performs best with Claude Opus 5.\n` +
        `Other models work but may have reduced orchestration quality.`,
    )
  }

  if (config.hasOpenCode && !hasAnyConfiguredProvider(config)) {
    p.log.warn(getNoModelProvidersWarning())
  }

  p.note(formatConfigSummary(config), isUpdate ? "Updated Configuration" : "Installation Complete")

  if (config.hasCodex) {
    const codexInstallation = await detectCodexInstallation()
    if (!codexInstallation.found) {
      p.log.warn(formatCodexInstallationWarning(codexInstallation))
    }

    spinner.start("Installing Codex harness adapter")
    try {
      const codexResult = await runCodexInstaller({ autonomousPermissions: config.codexAutonomous })
      spinner.stop(`Codex plugin installed to ${color.cyan(codexResult.configPath)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      spinner.stop(`Codex install failed ${color.yellow("[!]")}`)
      if (!config.hasOpenCode) {
        p.log.error(`Codex install failed: ${message}`)
        p.outro(color.red("Installation failed."))
        return 1
      }
      p.log.warn(`Codex install failed (OpenCode install remains successful): ${message}`)
      p.log.info(
        "The Codex harness is NOT installed. Fix the error above, then re-run: bunx oh-my-openagent install --platform=codex",
      )
    }
  }

  if (config.hasNative) {
    spinner.start("Installing OmO Native")
    const outcome = await runNativeInstall()
    if (outcome.failure) {
      spinner.stop(`OmO Native install failed ${color.yellow("[!]")}`)
      for (const line of nativeInstallFailureLines(outcome.failure)) p.log.error(line)
      p.outro(color.red("Installation failed."))
      return 1
    }
    spinner.stop(nativeInstallSuccessLine())
    for (const note of outcome.notes) p.log.info(note)
  }

  if (config.hasNativeDev) {
    spinner.start("Installing the OmO Native development adapter")
    try {
      const nativeDevResult = await runNativeDevInstaller()
      spinner.stop(`OmO Native development adapter installed to ${color.cyan(nativeDevResult.settingsPath)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      spinner.stop(`OmO Native development adapter install failed ${color.yellow("[!]")}`)
      p.log.error(`OmO Native development adapter install failed: ${message}`)
      p.outro(color.red("Installation failed."))
      return 1
    }
  }

  p.log.success(color.bold(isUpdate ? "Configuration updated!" : "Installation complete!"))
  if (config.hasOpenCode) {
    p.log.message(`Run ${color.cyan("opencode")} to start!`)
  }
  p.log.info("Anonymous telemetry is enabled by default. Disable it with OMO_SEND_ANONYMOUS_TELEMETRY=0 or OMO_DISABLE_POSTHOG=1.")
  p.log.info("Docs: docs/legal/privacy-policy.md and docs/legal/terms-of-service.md")

  p.note(
    `Include ${color.cyan("ultrawork")} (or ${color.cyan("ulw")}) in your prompt.\n` +
      `All features work like magic-parallel agents, background tasks,\n` +
      `deep exploration, and relentless execution until completion.`,
    "The Magic Word",
  )

  if (shouldShowNativeEditionHint(config)) {
    p.log.info(color.bold(NATIVE_EDITION_HINT_TITLE))
    p.log.message(nativeEditionHintLines({ command: color.cyan, link: color.underline }).join("\n"))
  }

  const shouldStar = await p.confirm({
    message: "Star the repos on GitHub?",
    initialValue: false,
  })
  if (!p.isCancel(shouldStar) && shouldStar) {
    spinner.start("Starring GitHub repositories")
    const results = await starGitHubRepositories(selectedPlatform)
    const failed = results.filter((result) => !result.ok)
    if (failed.length === 0) {
      spinner.stop("GitHub repositories starred")
    } else {
      spinner.stop("Could not star every repository")
      p.log.warn("Make sure GitHub CLI is installed and authenticated.")
    }
  }

  p.outro(color.green("oMoMoMoMo... Enjoy!"))

  if (config.hasOpenCode && (config.hasClaude || config.hasGemini || config.hasCopilot) && !args.skipAuth) {
    const providers: string[] = []
    if (config.hasClaude) providers.push(`Anthropic ${color.gray("→ Claude Pro/Max")}`)
    if (config.hasGemini) providers.push(`Google ${color.gray("→ Gemini")}`)
    if (config.hasCopilot) providers.push(`GitHub ${color.gray("→ Copilot")}`)

    console.log()
    console.log(color.bold("Authenticate Your Providers"))
    console.log()
    console.log(`   Run ${color.cyan("opencode auth login")} and select:`)
    for (const provider of providers) {
      console.log(`   ${SYMBOLS.bullet} ${provider}`)
    }
    console.log()
  }

  return 0
}
