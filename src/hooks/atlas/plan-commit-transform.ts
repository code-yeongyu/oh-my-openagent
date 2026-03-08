export function isPlanPath(filePath: string | undefined): boolean {
  if (!filePath) return false
  return /(^|[/\\])\.sisyphus[/\\]plans[/\\].*\.md$/.test(filePath)
}

/**
 * Uses negative lookahead to ensure idempotency (won't re-transform already-transformed content).
 */
export function transformPlanCommitFields(content: string): string {
  return content.replace(/\bCommit:\s*(YES|NO)(?!\s*\(user disabled auto-commits\))/g, "Commit: NO (user disabled auto-commits)")
}
