const KEYWORD_PATTERN = /\b(ultrawork|ulw)\b/gi
const WORKTREE_FLAG_PATTERN = /--worktree(?:\s+(\S+))?/
const WRAPPING_QUOTES_PATTERN = /^(["'`])([\s\S]*)\1$/

export interface ParsedUserRequest {
  planName: string | null
  explicitWorktreePath: string | null
}

export function parseUserRequest(promptText: string): ParsedUserRequest {
  const match = promptText.match(/<user-request>\s*([\s\S]*?)\s*<\/user-request>/i)
  if (!match) return { planName: null, explicitWorktreePath: null }

  let rawArg = match[1].trim()
  if (!rawArg) return { planName: null, explicitWorktreePath: null }

  const worktreeMatch = rawArg.match(WORKTREE_FLAG_PATTERN)
  const explicitWorktreePath = worktreeMatch ? (worktreeMatch[1] ?? null) : null

  if (worktreeMatch) {
    rawArg = rawArg.replace(worktreeMatch[0], "").trim()
  }

  const cleanedArg = rawArg.replace(KEYWORD_PATTERN, "").trim()
  const quotedPlanMatch = cleanedArg.match(WRAPPING_QUOTES_PATTERN)
  const normalizedPlanName = quotedPlanMatch ? quotedPlanMatch[2].trim() : cleanedArg

  return {
    planName: normalizedPlanName || null,
    explicitWorktreePath,
  }
}
