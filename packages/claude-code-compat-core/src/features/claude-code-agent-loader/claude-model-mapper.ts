import { normalizeModelFormat } from "../../shared/model-format-normalizer"
import { normalizeModelID } from "../../shared/model-normalization"
import { LATEST_MODEL_BY_FAMILY } from "@oh-my-opencode/model-core/latest-models"

const ANTHROPIC_PREFIX = "anthropic/"

const CLAUDE_CODE_ALIAS_MAP = new Map<string, string>([
  ["sonnet", `${ANTHROPIC_PREFIX}${LATEST_MODEL_BY_FAMILY.claudeSonnet}`],
  ["opus", `${ANTHROPIC_PREFIX}${LATEST_MODEL_BY_FAMILY.claudeOpus}`],
  ["haiku", `${ANTHROPIC_PREFIX}${LATEST_MODEL_BY_FAMILY.claudeHaiku}`],
])

function mapClaudeModelString(model: string | undefined, anthropicProvider?: string): string | undefined {
  if (!model) return undefined
  if (typeof model !== "string") return undefined

  const trimmed = model.trim()
  if (trimmed.length === 0) return undefined

  if (trimmed === "inherit") return undefined

  const prefix = anthropicProvider ? `${anthropicProvider}/` : ANTHROPIC_PREFIX
  const aliasResult = CLAUDE_CODE_ALIAS_MAP.get(trimmed.toLowerCase())
  if (aliasResult) return anthropicProvider ? aliasResult.replace(ANTHROPIC_PREFIX, prefix) : aliasResult

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
    return `${prefix}${normalized}`
  }

  return undefined
}

export function mapClaudeModelToOpenCode(
  model: string | undefined,
  anthropicProvider?: string,
): { providerID: string; modelID: string } | undefined {
  const mappedModel = mapClaudeModelString(model, anthropicProvider)
  return mappedModel ? normalizeModelFormat(mappedModel) : undefined
}
