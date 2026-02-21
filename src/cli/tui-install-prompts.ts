import * as p from "@clack/prompts"
import type { Option } from "@clack/prompts"
import type {
  BooleanArg,
  ClaudeSubscription,
  DetectedConfig,
  InstallConfig,
} from "./types"
import { detectedToInitialValues } from "./install-validators"
import { createEmptyLocalProviderModels, mapProbeResultsToLocalProviderModels } from "./local-model-capabilities"
import { probeLocalProviders } from "./local-provider-probe"

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

async function textOrCancel(params: {
  message: string
  placeholder: string
  initialValue?: string
}): Promise<string | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null

  const value = await p.text({
    message: params.message,
    placeholder: params.placeholder,
    initialValue: params.initialValue,
    validate: (input) => (isValidHttpUrl(input) ? undefined : "Please enter a valid http(s) URL"),
  })

  if (p.isCancel(value)) {
    p.cancel("Installation cancelled.")
    return null
  }

  return String(value).trim()
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

function localProviderLabel(provider: "lmstudio" | "ollama" | "vllm"): string {
  if (provider === "lmstudio") return "LMStudio"
  if (provider === "vllm") return "vLLM"
  return "Ollama"
}

async function promptLocalProviderUrl(params: {
  providerName: string
  initialEnabled: BooleanArg
  initialUrl?: string
  placeholder: string
}): Promise<string | undefined | null> {
  const enabled = await selectOrCancel<BooleanArg>({
    message: `Configure ${params.providerName} local endpoint?`,
    options: [
      { value: "no", label: "No (skip)", hint: "Do not probe this local provider" },
      { value: "yes", label: "Yes", hint: "Probe endpoint and add models to local fallback chain" },
    ],
    initialValue: params.initialEnabled,
  })

  if (!enabled) return null
  if (enabled === "no") return undefined

  return textOrCancel({
    message: `${params.providerName} URL`,
    placeholder: params.placeholder,
    initialValue: params.initialUrl,
  })
}

export async function promptInstallConfig(detected: DetectedConfig): Promise<InstallConfig | null> {
  const initial = detectedToInitialValues(detected)

  const claude = await selectOrCancel<ClaudeSubscription>({
    message: "Do you have a Claude Pro/Max subscription?",
    options: [
      { value: "no", label: "No", hint: "Will use opencode/big-pickle as fallback" },
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
      { value: "yes", label: "Yes", hint: "GPT-5.2 for Oracle (high-IQ debugging)" },
    ],
    initialValue: initial.openai,
  })
  if (!openai) return null

  const gemini = await selectOrCancel({
    message: "Will you integrate Google Gemini?",
    options: [
      { value: "no", label: "No", hint: "Frontend/docs agents will use fallback" },
      { value: "yes", label: "Yes", hint: "Beautiful UI generation with Gemini 3 Pro" },
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
      { value: "yes", label: "Yes", hint: "opencode/claude-opus-4-6, opencode/gpt-5.2, etc." },
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

  const lmstudioUrl = await promptLocalProviderUrl({
    providerName: "LMStudio",
    initialEnabled: detected.hasLmstudio ? "yes" : "no",
    initialUrl: detected.lmstudioUrl,
    placeholder: "http://localhost:1234/v1",
  })
  if (lmstudioUrl === null) return null

  const ollamaUrl = await promptLocalProviderUrl({
    providerName: "Ollama",
    initialEnabled: detected.hasOllama ? "yes" : "no",
    initialUrl: detected.ollamaUrl,
    placeholder: "http://localhost:11434",
  })
  if (ollamaUrl === null) return null

  const vllmUrl = await promptLocalProviderUrl({
    providerName: "vLLM",
    initialEnabled: detected.hasVllm ? "yes" : "no",
    initialUrl: detected.vllmUrl,
    placeholder: "http://localhost:8000/v1",
  })
  if (vllmUrl === null) return null

  const probeResults =
    lmstudioUrl || ollamaUrl || vllmUrl
      ? await probeLocalProviders({
          lmstudioUrl,
          ollamaUrl,
          vllmUrl,
        })
      : []
  const localProviderModels =
    probeResults.length > 0
      ? mapProbeResultsToLocalProviderModels(probeResults)
      : createEmptyLocalProviderModels()

  for (const result of probeResults) {
    const label = localProviderLabel(result.provider)
    if (result.warning) {
      p.log.warn(`${label} probe failed (${result.url}): ${result.warning}`)
      continue
    }

    if (result.models.length === 0) {
      p.log.warn(`${label} probe returned no models (${result.url})`)
      continue
    }

    const modelPreview = result.models.slice(0, 4).map((model) => model.id).join(", ")
    p.log.info(`${label}: found ${result.models.length} model(s)${modelPreview ? ` (${modelPreview})` : ""}`)
  }

  return {
    hasClaude: claude !== "no",
    isMax20: claude === "max20",
    hasOpenAI: openai === "yes",
    hasGemini: gemini === "yes",
    hasCopilot: copilot === "yes",
    hasOpencodeZen: opencodeZen === "yes",
    hasZaiCodingPlan: zaiCodingPlan === "yes",
    hasKimiForCoding: kimiForCoding === "yes",
    hasLmstudio: lmstudioUrl !== undefined,
    lmstudioUrl,
    hasOllama: ollamaUrl !== undefined,
    ollamaUrl,
    hasVllm: vllmUrl !== undefined,
    vllmUrl,
    localProviderModels,
  }
}
