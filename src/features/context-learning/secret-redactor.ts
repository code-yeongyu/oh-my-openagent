import type { RedactionResult } from "./types"

const SECRET_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?[\w\-]{20,}["']?/gi, type: "api_key" },
  { pattern: /(?:secret|password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{8,}["']?/gi, type: "secret" },
  { pattern: /Bearer\s+[\w\-_.~+/]+=*/gi, type: "bearer_token" },
  { pattern: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/g, type: "github_token" },
  { pattern: /sk-[A-Za-z0-9]{32,}/g, type: "openai_key" },
  { pattern: /xox[baprs]-[A-Za-z0-9\-]{10,}/g, type: "slack_token" },
  { pattern: /-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/g, type: "private_key" },
  { pattern: /(?:mongodb(?:\+srv)?|postgres|mysql|redis):\/\/[^\s]+/gi, type: "db_connection" },
  { pattern: /AKIA[0-9A-Z]{16}/g, type: "aws_access_key" },
  { pattern: /(?:aws[_-]?secret[_-]?(?:access[_-]?)?key|secret[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/gi, type: "aws_secret_key" },
]

export function redactSecrets(content: string): RedactionResult {
  let redacted = content
  const secretsFound: string[] = []

  for (const { pattern, type } of SECRET_PATTERNS) {
    const matches = redacted.match(pattern)
    if (matches) {
      for (const match of matches) {
        if (!secretsFound.includes(type)) {
          secretsFound.push(type)
        }
      }
      redacted = redacted.replace(pattern, `[REDACTED: ${type}]`)
    }
  }

  return {
    redacted,
    secretsFound: secretsFound.length,
    secretTypes: secretsFound,
  }
}

export function truncateExcerpt(text: string, maxLength: number = 200): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength - 3) + "..."
}

export function sanitizeForStorage(
  content: string,
  maxExcerptLength: number = 200
): string {
  const { redacted } = redactSecrets(content)
  return truncateExcerpt(redacted, maxExcerptLength)
}
