export function normalizeFeedbackText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
}

export function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function isCommentCheckerPackage(value: unknown): value is { getBinaryPath: () => string } {
  return isRecord(value) && typeof value["getBinaryPath"] === "function"
}

export function isUnknownFunction(value: unknown): value is () => unknown {
  return typeof value === "function"
}
