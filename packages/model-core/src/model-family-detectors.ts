import { parseVariantFromModelID } from "./model-string-parser"
import { isReasoningLevelOrAuto } from "./reasoning-level"

function extractModelName(model: string): string {
  return model.includes("/") ? (model.split("/").pop() ?? model) : model
}

export function isGptModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  return modelName.includes("gpt")
}

export function isGpt6AstraModel(model: string | undefined): boolean {
  if (!model) return false
  const { modelID, variant } = parseVariantFromModelID(model.toLowerCase(), { allowMaxSuffix: true })
  if (variant !== undefined && !isReasoningLevelOrAuto(variant)) return false
  return /^(?:gpt-6-astra|gpt-6-astra-fast)$/.test(extractModelName(modelID))
}

export function isClaudeOpus46Model(model: string): boolean {
  const family = "opus"
  const normalized = extractModelName(model).toLowerCase().replaceAll(".", "-")
  return normalized.includes(`${family}-4-6`)
}

export function isClaudeOpus47Model(model: string): boolean {
  const family = "opus"
  const normalized = extractModelName(model).toLowerCase().replaceAll(".", "-")
  return normalized.includes(`${family}-4-7`)
}

export function isClaudeOpus48Model(model: string): boolean {
  const family = "opus"
  const normalized = extractModelName(model).toLowerCase().replaceAll(".", "-")
  return normalized.includes(`${family}-4-8`)
}

export function isClaudeOpus5LegacyModel(model: string): boolean {
  const family = "opus"
  const normalized = extractModelName(model).toLowerCase().replaceAll(".", "-")
  if (normalized.includes(`${family}-5-5`)) return false
  return normalized.includes(`${family}-5`)
}

export function isClaudeFable5Model(model: string): boolean {
  const family = "fable"
  const normalized = extractModelName(model).toLowerCase().replaceAll(".", "-")
  if (normalized.includes(`${family}-5-1`) || normalized.includes(`mythos-5-1`)) return false
  return normalized.includes(`${family}-5`) || normalized.includes(`mythos-5`)
}

const CLAUDE_OPUS_VERSION_RE = /claude-opus-(\d+)(?:-(\d+))?/

/**
 * Claude Fable shares the Opus 4.7+ request surface (adaptive thinking only,
 * explicit enabled-thinking budgets rejected), so it counts as "4.7 or later".
 */
export function isClaudeOpus47OrLaterModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase().replaceAll(".", "-")
  if (modelName.includes("claude-fable")) return true
  const match = CLAUDE_OPUS_VERSION_RE.exec(modelName)
  if (!match) return false
  const major = Number(match[1])
  const minor = match[2] === undefined ? 0 : Number(match[2])
  if (Number.isNaN(major) || Number.isNaN(minor)) return false
  return major > 4 || (major === 4 && minor >= 7)
}

/**
 * Claude Fable / Mythos family (e.g. claude-fable-5, claude-mythos-5,
 * claude-mythos-preview). Like Opus 4.7+, these are adaptive-only: they reject
 * thinking.type "enabled" with a 400 and require adaptive thinking + effort,
 * which OpenCode core derives from the model variant.
 */
const CLAUDE_FABLE_OR_MYTHOS_RE = /claude-(?:fable|mythos)-(?:\d+|preview)/

export function isClaudeFableOrMythosModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase().replaceAll(".", "-")
  return CLAUDE_FABLE_OR_MYTHOS_RE.test(modelName)
}

export function isKimiK2Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  if (modelName.includes("kimi")) return true
  if (/k2[-.]?p[567]/.test(modelName)) return true
  return false
}

/**
 * Kimi Code addresses its models by rolling product ids that carry no version
 * signal. Moonshot upgraded `kimi-for-coding` to K2.8 Preview in place on
 * 2026-09-11 and left `kimi-for-coding-highspeed` on K2.7 Code HighSpeed.
 * https://www.kimi.com/code/docs/en/kimi-code/models.html (checked 2026-09-18)
 */
const KIMI_CODE_K27_MODEL_ID = "kimi-for-coding-highspeed"
const KIMI_CODE_K28_MODEL_ID = "kimi-for-coding"

export function isKimiK26Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  return /kimi-k2[.\-]?6/.test(modelName) || /k2[-.]?p6/.test(modelName)
}

export function isKimiK27Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  if (modelName === KIMI_CODE_K27_MODEL_ID) return true
  if (/kimi-k2[.\-]?7/.test(modelName)) return true
  if (/k2[-.]?p7/.test(modelName)) return true
  return false
}

export function isKimiK28Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  if (modelName === KIMI_CODE_K28_MODEL_ID) return true
  if (/kimi-k2[.\-]?8/.test(modelName)) return true
  if (/k2[-.]?p8/.test(modelName)) return true
  return false
}

/**
 * K2.7 Code and K2.8 Preview share one prompt. K2.8 is an efficiency and
 * context upgrade inside the same K2 coding family, not a new prompting
 * contract, so every prompt-routing site treats the two as one family.
 */
export function isKimiK2CodeModel(model: string): boolean {
  return isKimiK27Model(model) || isKimiK28Model(model)
}

export function isKimiK3Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  if (/kimi-k3/.test(modelName)) return true
  if (/k3[-.]?p?\d*$/.test(modelName)) return true
  return false
}

export function isSWE2Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  return /^swe-2(?:[-.]|$)/.test(modelName)
}

/**
 * The SWE-2 lanes Devin's Cascade serves. It answers every other SWE-2 uid - the bare `swe-2`, and
 * the `swe-2-low` / `swe-2-high-lite` strings that appear only inside the Devin CLI binary - with
 * `permission_denied`, so a config naming one fails every request.
 */
export const DEVIN_SWE2_SERVED_LANES = ["swe-2-medium", "swe-2-high", "swe-2-max"] as const

/** An explicit `devin/` selector naming a SWE-2 id outside {@link DEVIN_SWE2_SERVED_LANES}. */
export function isUnservedDevinSWE2Selector(selector: string): boolean {
  const separator = selector.indexOf("/")
  if (separator <= 0 || selector.slice(0, separator).toLowerCase() !== "devin") return false
  // A reasoning suffix (`:high`, ` (high)`) rides on the selector, never on the uid Cascade sees.
  const modelId = selector.slice(separator + 1).trim().toLowerCase().split(/[:\s(]/u)[0] ?? ""
  if (!isSWE2Model(modelId)) return false
  return !(DEVIN_SWE2_SERVED_LANES as readonly string[]).includes(modelId)
}

export function isMiniMaxModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  return modelName.includes("minimax")
}

export function isGlmModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  return modelName.includes("glm-") || /glm\d/.test(modelName)
}

/**
 * Grok 4.5 / 4.6 need a digit boundary after the minor version: the xAI catalog
 * also ships grok-4.20 (and grok-4.1/4.2/4.3 fast tiers), so a bare substring
 * match on "grok-4-5" would swallow future grok-4.5x ids and "grok-4-2" would
 * swallow grok-4.20 today. Suffixed ids (grok-4.5-fast) still match.
 */
const GROK_45_RE = /grok-4-5(?![0-9])/
const GROK_46_RE = /grok-4-6(?![0-9])/

export function isGrok45Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase().replaceAll(".", "-")
  return GROK_45_RE.test(modelName)
}

export function isGrok46Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase().replaceAll(".", "-")
  return GROK_46_RE.test(modelName)
}

const GEMINI_PROVIDERS = ["google/", "google-vertex/"] as const

export function isGeminiModel(model: string): boolean {
  if (GEMINI_PROVIDERS.some((prefix) => model.startsWith(prefix))) return true

  if (
    model.startsWith("github-copilot/") &&
    extractModelName(model).toLowerCase().startsWith("gemini")
  )
    return true

  const modelName = extractModelName(model).toLowerCase()
  return modelName.startsWith("gemini-")
}
