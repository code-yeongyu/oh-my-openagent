export const TASK_SUMMARY_MAX_LENGTH = 80

const ELLIPSIS = "..."

// Harness-side enforcement of the schema maxLength: the tool advertises the limit, but an
// over-limit value is force-truncated here (prepareArguments runs before schema validation)
// instead of failing the spawn.
export function clampTaskSummary(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim().replace(/\s+/gu, " ")
  if (normalized.length === 0) return undefined
  if (normalized.length <= TASK_SUMMARY_MAX_LENGTH) return normalized
  return `${normalized.slice(0, TASK_SUMMARY_MAX_LENGTH - ELLIPSIS.length)}${ELLIPSIS}`
}
