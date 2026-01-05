export interface ModelCapabilities {
  supportsReasoningEffort: boolean
  supportsTextVerbosity: boolean
  supportsThinking: boolean
}

const REASONING_MODELS = [
  /^gpt-5(\b|-)/,
  /^o1(\b|-)/,
  /^o3(\b|-)/,
]

function normalizeModelID(modelID: string): string {
  return modelID.replace(/\.(\d+)/g, "-$1")
}

function getBaseModelID(modelID: string): string {
  const lower = modelID.toLowerCase()
  const parts = lower.split("/")
  return normalizeModelID(parts[parts.length - 1] ?? lower)
}

export function getModelCapabilities(modelID: string): ModelCapabilities {
  const base = getBaseModelID(modelID)
  const supportsReasoningEffort = REASONING_MODELS.some((pattern) => pattern.test(base))
  const supportsTextVerbosity = supportsReasoningEffort
  const supportsThinking = base.includes("claude")

  return { supportsReasoningEffort, supportsTextVerbosity, supportsThinking }
}
