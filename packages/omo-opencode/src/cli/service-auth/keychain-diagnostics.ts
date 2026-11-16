/** Throwaway #13757 probe: only primitive allowlisted fields ever reach stderr. */
export function keychainDiagnostic(site: string, detail: unknown, depth = 0): void {
  if (process.env.OMO_KEYCHAIN_DIAGNOSTICS !== "1" || depth > 6) return
  if (typeof detail !== "object" || detail === null) return
  const error = detail instanceof Error
  const source = error
    ? {
        constructor: detail.constructor.name,
        code: "code" in detail ? detail.code : undefined,
        status: "status" in detail ? detail.status : undefined,
        failure: "failure" in detail ? detail.failure : undefined,
        message: detail.message,
      }
    : detail
  const fields: Record<string, string | number | boolean> = {}
  const keys = error
    ? ["constructor", "code", "status", "failure", "message"]
    : ["verb", "ok", "error", "status", "reason", "owned"]
  for (const key of keys) {
    const value: unknown = Reflect.get(source, key)
    if (key === "constructor" && typeof value === "string") {
      fields[key] = value
      continue
    }
    if (typeof value === "string") {
      const redacted = value
        .replace(/\b(?:Bearer|Basic)\s+\S+/gi, "[REDACTED]")
        .replace(
          /((?:token|password|secret|credential|authorization|(?:private|api)[_-]?key)\s*["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
          "$1[REDACTED]",
        )
        .replace(/\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
        .replace(/[A-Za-z0-9_+/-]{21,}={0,2}/g, "[REDACTED]")
      fields[key] = key === "message" ? redacted.slice(0, 200) : redacted
    } else if (typeof value === "number" || typeof value === "boolean") {
      fields[key] = value
    }
  }
  process.stderr.write(`omo-keychain-diag: ${site} ${JSON.stringify(fields)}\n`)
  if (error) {
    if (detail.cause !== undefined) keychainDiagnostic(site, detail.cause, depth + 1)
    if (detail instanceof AggregateError) {
      for (const child of detail.errors) keychainDiagnostic(site, child, depth + 1)
    }
  }
}
