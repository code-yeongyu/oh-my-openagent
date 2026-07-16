function extractModelName(model: string): string {
  return model.includes("/") ? (model.split("/").pop() ?? model) : model
}

export function isGptModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  return modelName.includes("gpt")
}

export function isClaudeOpus46Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase().replaceAll(".", "-")
  return modelName.includes("claude-opus-4-6")
}

export function isClaudeOpus47Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase().replaceAll(".", "-")
  return modelName.includes("claude-opus-4-7")
}

export function isClaudeOpus48Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase().replaceAll(".", "-")
  return modelName.includes("claude-opus-4-8")
}

export function isClaudeFable5Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase().replaceAll(".", "-")
  return modelName.includes("claude-fable-5")
}

const CLAUDE_OPUS_VERSION_RE = /claude-opus-(\d+)-(\d+)/

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
  const minor = Number(match[2])
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

export function isKimiK27Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  if (/kimi-k2[.\-]?7/.test(modelName)) return true
  if (/k2[-.]?p7/.test(modelName)) return true
  return false
}

const MINIMAX_MODEL_RE = /(?:minimax|^mimo(?:$|[-.]))/

export function isMiniMaxModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  return MINIMAX_MODEL_RE.test(modelName)
}

export function isGlmModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  return modelName.includes("glm")
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
