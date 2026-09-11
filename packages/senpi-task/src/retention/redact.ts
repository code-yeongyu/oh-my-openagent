// Built-in secret redaction for retained transcripts. Two layers keep archives safe to keep on
// disk: (1) the engine event log already key-redacts sensitive object keys at write time
// (store/redaction.ts), and (2) this module pattern-redacts well-known credential SHAPES from
// every free-text surface an archive carries (prompt, assistant prose, tool output payloads,
// final response, error messages, metadata strings). Redaction is deterministic and content-based
// only - it never inspects or phones home anything.
export const ARCHIVE_REDACTION_ID = "builtin-v1"

const REDACTED = "[REDACTED]"

// Well-known credential shapes, ordered longest-prefix-first within each family so the most
// specific pattern wins. Deliberately conservative: every pattern requires a recognizable
// vendor/structure prefix plus a high-entropy body, minimizing false positives on prose.
const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{16,}/g, // anthropic api key
  /sk-proj-[A-Za-z0-9_-]{16,}/g, // openai project key
  /sk-[A-Za-z0-9]{32,}/g, // openai-style legacy key (lenient body; sk-ant/sk-proj matched first)
  /AKIA[0-9A-Z]{16}/g, // aws access key id
  /ASIA[0-9A-Z]{16}/g, // aws temporary access key id
  /gh[pousr]_[A-Za-z0-9]{36,}/g, // github token
  /gho_[A-Za-z0-9]{36,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // slack token
  /AIza[0-9A-Za-z_-]{35}/g, // google api key
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // jwt (three dot-separated base64url segments)
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g, // bearer token header value
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g, // pem private key block
]

// Redact secret-shaped substrings from a single string. Returns the original reference when
// nothing matches so unchanged text costs no allocation.
export function redactArchiveText(text: string): string {
  let result = text
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(result)) result = result.replace(pattern, REDACTED)
    pattern.lastIndex = 0
  }
  return result
}

// Deep, structure-preserving redaction: walks objects and arrays and redacts every string value
// (keys are left as-is; sensitive KEYS are already handled by store/redaction.ts at log time).
export function redactArchiveValue(value: unknown): unknown {
  if (typeof value === "string") return redactArchiveText(value)
  if (Array.isArray(value)) return value.map((entry) => redactArchiveValue(entry))
  if (typeof value === "object" && value !== null) {
    const redacted: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) redacted[key] = redactArchiveValue(entry)
    return redacted
  }
  return value
}
