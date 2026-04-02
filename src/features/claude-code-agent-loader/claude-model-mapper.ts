import { normalizeModelFormat } from "../../shared/model-format-normalizer"
import { normalizeModelID } from "../../shared/model-normalization"

const ANTHROPIC_PREFIX = "anthropic/"

const CLAUDE_CODE_ALIAS_MAP = new Map<string, string>([
  ["sonnet", `${ANTHROPIC_PREFIX}claude-sonnet-4-6`],
  ["opus", `${ANTHROPIC_PREFIX}claude-opus-4-6`],
  ["haiku", `${ANTHROPIC_PREFIX}claude-haiku-4-5`],
])

function mapClaudeModelString(model: string | undefined): string | undefined {
  if (!model) return undefined

  const trimmed = model.trim()
  if (trimmed.length === 0) return undefined

  if (trimmed === "inherit") return undefined

  const aliasResult = CLAUDE_CODE_ALIAS_MAP.get(trimmed.toLowerCase())
  if (aliasResult) return aliasResult

  if (trimmed.includes("/")) {
    const [providerID, ...modelParts] = trimmed.split("/")
    const modelID = modelParts.join("/")

    if (providerID.length === 0 || modelID.length === 0) return trimmed

    return modelID.startsWith("claude-")
      ? `${providerID}/${normalizeModelID(modelID)}`
      : trimmed
  }

  const normalized = normalizeModelID(trimmed)

  if (normalized.startsWith("claude-")) {
    return `${ANTHROPIC_PREFIX}${normalized}`
  }

  return undefined
}

export function mapClaudeModelToOpenCode(
  model: string | undefined
): { providerID: string; modelID: string } | undefined {
  const mappedModel = mapClaudeModelString(model)
  return mappedModel ? normalizeModelFormat(mappedModel) : undefined
}
