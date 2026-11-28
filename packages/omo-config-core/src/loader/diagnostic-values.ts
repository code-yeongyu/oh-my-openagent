import type * as z from "zod"

export function configFileErrorCode(error: unknown): string {
  const code = error instanceof Error ? Reflect.get(error, "code") : undefined
  return typeof code === "string" && ["EACCES", "EPERM", "ENOSPC", "EROFS", "EXDEV", "ENOENT", "EIO", "ENOTDIR", "EISDIR"].includes(code)
    ? ` (${code})`
    : ""
}

/** Schema messages may embed received input, including credentials in custom refinements. */
export function configIssueSummary(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "invalid_type": return `Expected ${issue.expected}`
    case "invalid_value": return "Expected a supported value"
    case "too_big": return "Value exceeds the maximum"
    case "too_small": return "Value is below the minimum"
    case "invalid_format": return "Invalid format"
    case "unrecognized_keys": return "Unrecognized keys"
    default: return "Invalid value"
  }
}

/** Keep identifiers useful to doctor without echoing credentials embedded in URL identifiers. */
export function displayConfigIdentifier(value: string): string {
  return value.replace(/[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/gi, (match) => {
    try {
      const url = new URL(match)
      url.username = ""
      url.password = ""
      url.search = ""
      url.hash = ""
      return url.href
    } catch {
      return "[invalid URL]"
    }
  })
}
