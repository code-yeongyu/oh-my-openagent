export type ParsedAspicPayload = {
  acceptedConclusions: string[]
  extensionsCount: number
}

export function parseAspicPayload(payload: unknown): ParsedAspicPayload {
  return {
    acceptedConclusions: extractAcceptedConclusions(payload),
    extensionsCount: extractExtensions(payload).length,
  }
}

export function readStatusVerdict(
  conclusions: ReadonlyArray<string>,
  hypothesisId: string,
): "refuted" | "confirmed" | null {
  for (const conclusion of conclusions) {
    if (matchesStatusConclusion(conclusion, "refuted", hypothesisId)) return "refuted"
    if (matchesStatusConclusion(conclusion, "confirmed", hypothesisId)) return "confirmed"
  }
  return null
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function matchesStatusConclusion(
  conclusion: string,
  status: "refuted" | "confirmed",
  hypothesisId: string,
): boolean {
  const id = escapeRegex(hypothesisId)
  const pattern = new RegExp(
    `^${status}\\(hypothesis\\(\\s*"?${id}"?\\s*(?:,\\s*"(?:\\\\.|[^"\\\\])*")?\\s*\\)\\)$`,
  )
  return pattern.test(conclusion)
}

function extractAcceptedConclusions(payload: unknown): string[] {
  const accepted: string[] = []
  if (!isRecord(payload)) return accepted
  const root = isRecord(payload.structuredContent) ? payload.structuredContent : payload
  const conclusions = isRecord(root.conclusions)
    ? root.conclusions
    : isRecord(root.result) && isRecord(root.result.conclusions)
    ? root.result.conclusions
    : null
  if (!conclusions) return accepted
  for (const [key, value] of Object.entries(conclusions)) {
    if (isRecord(value) && value.status === "Accepted") {
      accepted.push(key)
    }
  }
  return accepted
}

function extractExtensions(payload: unknown): unknown[] {
  if (!isRecord(payload)) return []
  const root = isRecord(payload.structuredContent) ? payload.structuredContent : payload
  if (Array.isArray(root.extensions)) return root.extensions
  if (isRecord(root.result) && Array.isArray(root.result.extensions)) return root.result.extensions
  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
