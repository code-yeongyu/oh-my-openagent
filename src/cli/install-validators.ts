import color from "picocolors"
import type {
  BooleanArg,
  ClaudeSubscription,
  DetectedConfig,
  InstallArgs,
  InstallConfig,
} from "./types"

export const SYMBOLS = {
  check: color.green("[OK]"),
  cross: color.red("[X]"),
  arrow: color.cyan("->"),
  bullet: color.dim("*"),
  info: color.blue("[i]"),
  warn: color.yellow("[!]"),
  star: color.yellow("*"),
}

function formatProvider(name: string, enabled: boolean, detail?: string): string {
  const status = enabled ? SYMBOLS.check : color.dim("○")
  const label = enabled ? color.white(name) : color.dim(name)
  const suffix = detail ? color.dim(` (${detail})`) : ""
  return `  ${status} ${label}${suffix}`
}

export function formatConfigSummary(config: InstallConfig): string {
  const lines: string[] = []

  lines.push(color.bold(color.white("Configuration Summary")))
  lines.push("")

  const claudeDetail = config.hasClaude ? (config.isMax20 ? "max20" : "standard") : undefined
  lines.push(formatProvider("Claude", config.hasClaude, claudeDetail))
  lines.push(formatProvider("OpenAI/ChatGPT", config.hasOpenAI, "GPT-5.2 for Oracle"))
  lines.push(formatProvider("Gemini", config.hasGemini))
  lines.push(formatProvider("GitHub Copilot", config.hasCopilot, "fallback"))
  lines.push(formatProvider("OpenCode Zen", config.hasOpencodeZen, "opencode/ models"))
  lines.push(formatProvider("Z.ai Coding Plan", config.hasZaiCodingPlan, "Librarian/Multimodal"))
  lines.push(formatProvider("Kimi For Coding", config.hasKimiForCoding, "Sisyphus/Prometheus fallback"))

  lines.push("")
  lines.push(color.dim("─".repeat(40)))
  lines.push("")

  lines.push(color.bold(color.white("Model Assignment")))
  lines.push("")
  lines.push(`  ${SYMBOLS.info} Models auto-configured based on provider priority`)
  lines.push(`  ${SYMBOLS.bullet} Priority: Native > Copilot > OpenCode Zen > Z.ai`)

  return lines.join("\n")
}

export function printHeader(isUpdate: boolean): void {
  const mode = isUpdate ? "Update" : "Install"
  console.log()
  console.log(color.bgMagenta(color.white(` oMoMoMoMo... ${mode} `)))
  console.log()
}

export function printStep(step: number, total: number, message: string): void {
  const progress = color.dim(`[${step}/${total}]`)
  console.log(`${progress} ${message}`)
}

export function printSuccess(message: string): void {
  console.log(`${SYMBOLS.check} ${message}`)
}

export function printError(message: string): void {
  console.log(`${SYMBOLS.cross} ${color.red(message)}`)
}

export function printInfo(message: string): void {
  console.log(`${SYMBOLS.info} ${message}`)
}

export function printWarning(message: string): void {
  console.log(`${SYMBOLS.warn} ${color.yellow(message)}`)
}

export function printBox(content: string, title?: string): void {
  const lines = content.split("\n")
  const maxWidth =
    Math.max(
      ...lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").length),
      title?.length ?? 0,
    ) + 4
  const border = color.dim("─".repeat(maxWidth))

  console.log()
  if (title) {
    console.log(
      color.dim("┌─") +
        color.bold(` ${title} `) +
        color.dim("─".repeat(maxWidth - title.length - 4)) +
        color.dim("┐"),
    )
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

export function validateNonTuiArgs(args: InstallArgs): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (args.claude === undefined) {
    errors.push("--claude is required (values: no, yes, max20)")
  } else if (!["no", "yes", "max20"].includes(args.claude)) {
    errors.push(`Invalid --claude value: ${args.claude} (expected: no, yes, max20)`)
  }

  if (args.gemini === undefined) {
    errors.push("--gemini is required (values: no, yes)")
  } else if (!["no", "yes"].includes(args.gemini)) {
    errors.push(`Invalid --gemini value: ${args.gemini} (expected: no, yes)`)
  }

  if (args.copilot === undefined) {
    errors.push("--copilot is required (values: no, yes)")
  } else if (!["no", "yes"].includes(args.copilot)) {
    errors.push(`Invalid --copilot value: ${args.copilot} (expected: no, yes)`)
  }

  if (args.openai !== undefined && !["no", "yes"].includes(args.openai)) {
    errors.push(`Invalid --openai value: ${args.openai} (expected: no, yes)`)
  }

  if (args.opencodeZen !== undefined && !["no", "yes"].includes(args.opencodeZen)) {
    errors.push(`Invalid --opencode-zen value: ${args.opencodeZen} (expected: no, yes)`)
  }

  if (args.zaiCodingPlan !== undefined && !["no", "yes"].includes(args.zaiCodingPlan)) {
    errors.push(`Invalid --zai-coding-plan value: ${args.zaiCodingPlan} (expected: no, yes)`)
  }

  if (args.kimiForCoding !== undefined && !["no", "yes"].includes(args.kimiForCoding)) {
    errors.push(`Invalid --kimi-for-coding value: ${args.kimiForCoding} (expected: no, yes)`)
  }

  return { valid: errors.length === 0, errors }
}

export function argsToConfig(args: InstallArgs): InstallConfig {
  return {
    hasClaude: args.claude !== "no",
    isMax20: args.claude === "max20",
    hasOpenAI: args.openai === "yes",
    hasGemini: args.gemini === "yes",
    hasCopilot: args.copilot === "yes",
    hasOpencodeZen: args.opencodeZen === "yes",
    hasZaiCodingPlan: args.zaiCodingPlan === "yes",
    hasKimiForCoding: args.kimiForCoding === "yes",
  }
}

export function detectedToInitialValues(detected: DetectedConfig): {
  claude: ClaudeSubscription
  openai: BooleanArg
  gemini: BooleanArg
  copilot: BooleanArg
  opencodeZen: BooleanArg
  zaiCodingPlan: BooleanArg
  kimiForCoding: BooleanArg
} {
  let claude: ClaudeSubscription = "no"
  if (detected.hasClaude) {
    claude = detected.isMax20 ? "max20" : "yes"
  }

  return {
    claude,
    openai: detected.hasOpenAI ? "yes" : "no",
    gemini: detected.hasGemini ? "yes" : "no",
    copilot: detected.hasCopilot ? "yes" : "no",
    opencodeZen: detected.hasOpencodeZen ? "yes" : "no",
    zaiCodingPlan: detected.hasZaiCodingPlan ? "yes" : "no",
    kimiForCoding: detected.hasKimiForCoding ? "yes" : "no",
  }
}
