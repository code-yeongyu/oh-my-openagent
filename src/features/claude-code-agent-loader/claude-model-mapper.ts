import { normalizeModelID } from "../../shared/model-normalization"

const DATE_SUFFIX_PATTERN = /-\d{8}$/

export function mapClaudeModelToOpenCode(model: string | undefined): string | undefined {
  if (!model) return undefined

  const trimmed = model.trim()
  if (trimmed.length === 0) return undefined

  const withoutDate = trimmed.replace(DATE_SUFFIX_PATTERN, "")
  return normalizeModelID(withoutDate)
}
