import { basename } from "node:path"
import picomatch from "picomatch"

const DEFAULT_BLOCKED_PATTERNS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.jks",
  "*.keystore",
  "id_rsa",
  "id_ed25519",
  "credentials.json",
  "service-account*.json",
  ".npmrc",
  ".pypirc",
]

export function createSensitiveFileMatcher(
  blockedPatterns?: string[],
  allowedPaths?: string[],
) {
  const patterns = blockedPatterns ?? DEFAULT_BLOCKED_PATTERNS
  const isBlocked = picomatch(patterns, { dot: true, bash: true })
  const allowSet = new Set(allowedPaths ?? [])

  return function isSensitiveFile(filePath: string): boolean {
    if (allowSet.has(filePath)) return false

    const fileName = basename(filePath)
    return isBlocked(fileName) || isBlocked(filePath)
  }
}
