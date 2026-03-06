import { normalizeModelID } from "../../shared/model-normalization"

const ANTHROPIC_PREFIX = "anthropic/"

export function mapClaudeModelToOpenCode(model: string | undefined): string | undefined {
  if (!model) return undefined

  const trimmed = model.trim()
  if (trimmed.length === 0) return undefined

  if (trimmed.includes("/")) {
    return trimmed
  }

  const normalized = normalizeModelID(trimmed)

  if (normalized.startsWith("claude-")) {
    return `${ANTHROPIC_PREFIX}${normalized}`
  }

  return normalized
}
