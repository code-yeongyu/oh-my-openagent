import * as p from "@clack/prompts"
import type { Option } from "@clack/prompts"
import type {
  ClaudeSubscription,
  DetectedConfig,
  InstallConfig,
  InstallPlatform,
} from "./types"
import { detectedToInitialValues } from "./install-validators"
import { ULTIMATE_FALLBACK } from "./model-fallback"
import { isSenpiPlatformEnabled } from "./senpi-platform-flag"

async function selectOrCancel<TValue extends Readonly<string | boolean | number>>(params: {
  message: string
  options: Option<TValue>[]
  initialValue: TValue
}): Promise<TValue | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null

  const value = await p.select<TValue>({
    message: params.message,
    options: params.options,
    initialValue: params.initialValue,
  })
  if (p.isCancel(value)) {
    p.cancel("Installation cancelled.")
    return null
  }
  return value as TValue
}

export async function promptInstallPlatform(
  initialValue: InstallPlatform = "opencode",
): Promise<InstallPlatform | null> {
  const options: Option<InstallPlatform>[] = [
    { value: "opencode", label: "OpenCode", hint: "Install OpenCode plugin only" },
    { value: "codex", label: "Codex", hint: "Install Codex harness adapter only" },
    { value: "both", label: "Both", hint: "Install OpenCode plugin and Codex adapter" },
  ]
  if (isSenpiPlatformEnabled()) {
    options.push({ value: "senpi", label: "Senpi", hint: "Install Senpi harness adapter only" })
  }

  return selectOrCancel<InstallPlatform>({
    message: "Which platform do you want to install?",
    options,
    initialValue,
  })
}

export async function promptInstallConfig(
  detected: DetectedConfig,
  platform: InstallPlatform,
  codexAutonomousOverride?: boolean,
): Promise<InstallConfig | null> {
  const hasOpenCode = platform === "opencode" || platform === "both"
  const hasCodex = platform === "codex" || platform === "both"
  const hasSenpi = platform === "senpi"
  const codexAutonomous = await resolveCodexAutonomous(hasCodex, codexAutonomousOverride)
  if (codexAutonomous === null) return null

  if (!hasOpenCode) {
    return {
      platform,
      hasOpenCode: false,
      hasClaude: false,
      isMax20: false,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasCodex,
      hasSenpi,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
      hasOpencodeGo: false,
      hasBailianCodingPlan: false,
      hasMinimaxCnCodingPlan: false,
      hasMinimaxCodingPlan: false,
      hasVercelAiGateway: false,
      codexAutonomous,
    }
  }

  const initial = detectedToInitialValues(detected)

  const claude = await selectOrCancel<ClaudeSubscription>({
    message: "Do you have a Claude Pro/Max subscription?",
    options: [
      { value: "no", label: "No", hint: `Will use ${ULTIMATE_FALLBACK} as fallback` },
      { value: "yes", label: "Yes (standard)", hint: "Claude Opus 4.5 for orchestration" },
      { value: "max20", label: "Yes (max20 mode)", hint: "Full power with Claude Sonnet 4.6 for Librarian" },
    ],
    initialValue: initial.claude,
  })
  if (!claude) return null

  const openai = await selectOrCancel({
    message: "Do you have an OpenAI/ChatGPT Plus subscription?",
    options: [
      { value: "no", label: "No", hint: "Oracle will use fallback models" },
      { value: "yes", label: "Yes", hint: "GPT-5.4 for Oracle (high-IQ debugging)" },
    ],
    initialValue: initial.openai,
  })
  if (!openai) return null

  const gemini = await selectOrCancel({
    message: "Will you integrate Google Gemini?",
    options: [
      { value: "no", label: "No", hint: "Frontend/docs agents will use fallback" },
      { value: "yes", label: "Yes", hint: "Beautiful UI generation with Gemini 3.1 Pro" },
    ],
    initialValue: initial.gemini,
  })
  if (!gemini) return null

  const copilot = await selectOrCancel({
    message: "Do you have a GitHub Copilot subscription?",
    options: [
      { value: "no", label: "No", hint: "Only native providers will be used" },
      { value: "yes", label: "Yes", hint: "Fallback option when native providers unavailable" },
    ],
    initialValue: initial.copilot,
  })
  if (!copilot) return null

  const opencodeZen = await selectOrCancel({
    message: "Do you have access to OpenCode Zen (opencode/ models)?",
    options: [
      { value: "no", label: "No", hint: "Will use other configured providers" },
      { value: "yes", label: "Yes", hint: "opencode/claude-opus-4-7, opencode/gpt-5.5, etc." },
    ],
    initialValue: initial.opencodeZen,
  })
  if (!opencodeZen) return null

  const zaiCodingPlan = await selectOrCancel({
    message: "Do you have a Z.ai Coding Plan subscription?",
    options: [
      { value: "no", label: "No", hint: "Will use other configured providers" },
      { value: "yes", label: "Yes", hint: "Fallback for Librarian and Multimodal Looker" },
    ],
    initialValue: initial.zaiCodingPlan,
  })
  if (!zaiCodingPlan) return null

  const kimiForCoding = await selectOrCancel({
    message: "Do you have a Kimi For Coding subscription?",
    options: [
      { value: "no", label: "No", hint: "Will use other configured providers" },
      { value: "yes", label: "Yes", hint: "Kimi K2.5 for Sisyphus/Prometheus fallback" },
    ],
    initialValue: initial.kimiForCoding,
  })
  if (!kimiForCoding) return null

  const opencodeGo = await selectOrCancel({
    message: "Do you have an OpenCode Go subscription?",
    options: [
      { value: "no", label: "No", hint: "Will use other configured providers" },
      { value: "yes", label: "Yes", hint: "OpenCode Go for quick tasks" },
    ],
    initialValue: initial.opencodeGo,
  })
  if (!opencodeGo) return null

  const bailianCodingPlan = await selectOrCancel({
    message: "Do you have a Bailian Coding Plan subscription?",
    options: [
      { value: "no", label: "No", hint: "Will use other configured providers" },
      { value: "yes", label: "Yes", hint: "Qwen, GLM, and Kimi fallback route" },
    ],
    initialValue: initial.bailianCodingPlan,
  })
  if (!bailianCodingPlan) return null

  const minimaxCnCodingPlan = await selectOrCancel({
    message: "Do you have a MiniMax Coding Plan (minimaxi.com) subscription?",
    options: [
      { value: "no", label: "No", hint: "Will use other configured providers" },
      { value: "yes", label: "Yes", hint: "Enables MiniMax-M3 fallback models via minimaxi.com" },
    ],
    initialValue: initial.minimaxCnCodingPlan,
  })
  if (!minimaxCnCodingPlan) return null

  const minimaxCodingPlan = await selectOrCancel({
    message: "Do you have a MiniMax Coding Plan (minimax.io) subscription?",
    options: [
      { value: "no", label: "No", hint: "Will use other configured providers" },
      { value: "yes", label: "Yes", hint: "Enables MiniMax-M3 fallback models via minimax.io" },
    ],
    initialValue: initial.minimaxCodingPlan,
  })
  if (!minimaxCodingPlan) return null

  const vercelAiGateway = await selectOrCancel({
    message: "Do you have a Vercel AI Gateway API key?",
    options: [
      { value: "no", label: "No", hint: "Will use other configured providers" },
      { value: "yes", label: "Yes", hint: "Universal proxy for OpenAI, Anthropic, Google, etc." },
    ],
    initialValue: initial.vercelAiGateway,
  })
  if (!vercelAiGateway) return null

  return {
    platform,
    hasOpenCode: true,
    hasClaude: claude !== "no",
    isMax20: claude === "max20",
    hasOpenAI: openai === "yes",
    hasGemini: gemini === "yes",
    hasCopilot: copilot === "yes",
    hasCodex,
    hasSenpi,
    hasOpencodeZen: opencodeZen === "yes",
    hasZaiCodingPlan: zaiCodingPlan === "yes",
    hasKimiForCoding: kimiForCoding === "yes",
    hasOpencodeGo: opencodeGo === "yes",
    hasBailianCodingPlan: bailianCodingPlan === "yes",
    hasMinimaxCnCodingPlan: minimaxCnCodingPlan === "yes",
    hasMinimaxCodingPlan: minimaxCodingPlan === "yes",
    hasVercelAiGateway: vercelAiGateway === "yes",
    codexAutonomous,
  }
}

async function resolveCodexAutonomous(
  hasCodex: boolean,
  override: boolean | undefined,
): Promise<boolean | null> {
  if (!hasCodex) return false
  if (override !== undefined) return override
  return true
}
