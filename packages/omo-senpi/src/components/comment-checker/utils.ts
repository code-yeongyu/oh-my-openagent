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

// Bun 1.3.x throws a ResolveMessage for a missing module; it carries MODULE_NOT_FOUND but is not an
// Error instance (Bun 1.4.0 made it one). Node and later Bun throw a real Error, which is also missing.
export function isMissingModuleValue(value: unknown): boolean {
  if (value instanceof Error) return true
  return isRecord(value) && (value["code"] === "MODULE_NOT_FOUND" || value["name"] === "ResolveMessage")
}

export function isUnknownFunction(value: unknown): value is () => unknown {
  return typeof value === "function"
}
