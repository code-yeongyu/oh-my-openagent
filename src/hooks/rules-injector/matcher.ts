import { createHash } from "crypto"
import { relative } from "node:path"
import picomatch from "picomatch"
import type { RuleMetadata } from "./types"

export interface MatchResult {
  applies: boolean
  reason?: string
}

/**
 * Check if a rule should apply to the current file based on metadata
 */
export function shouldApplyRule(
  metadata: RuleMetadata,
  currentFilePath: string,
  projectRoot: string | null
): MatchResult {
  if (metadata.alwaysApply === true) {
    return { applies: true, reason: "alwaysApply" }
  }

  const globs = metadata.globs
  if (!globs) {
    return { applies: false }
  }

  const patterns = Array.isArray(globs) ? globs : [globs]
  if (patterns.length === 0) {
    return { applies: false }
  }

  const relativePath = projectRoot ? relative(projectRoot, currentFilePath) : currentFilePath

  for (const pattern of patterns) {
    if (picomatch.isMatch(relativePath, pattern, { dot: true, bash: true })) {
      return { applies: true, reason: `glob: ${pattern}` }
    }
  }

  return { applies: false }
}

/**
 * Check if realPath already exists in cache (symlink deduplication)
 */
export function isDuplicateByRealPath(realPath: string, cache: Set<string>): boolean {
  return cache.has(realPath)
}

/**
 * Create SHA-256 hash of content, truncated to 16 chars
 */
export function createContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16)
}

/**
 * Check if content hash already exists in cache
 */
export function isDuplicateByContentHash(hash: string, cache: Set<string>): boolean {
  return cache.has(hash)
}
