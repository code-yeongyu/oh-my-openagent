const KEYWORD_PATTERN = /\b(ultrawork|ulw)\b/gi
const WORKTREE_FLAG_PATTERN = /--worktree(?:\s+(\S+))?/
const MAKE_PR_FLAG_PATTERN = /--make-pr\b/
const SHIP_FLAG_PATTERN = /--ship\b/
const WRAPPING_QUOTES_PATTERN = /^(["'`])([\s\S]*)\1$/

export interface ParsedUserRequest {
  planName: string | null
  explicitWorktreePath: string | null
  makePr: boolean
  ship: boolean
}

const EMPTY_REQUEST: ParsedUserRequest = {
  planName: null,
  explicitWorktreePath: null,
  makePr: false,
  ship: false,
}

export function parseUserRequest(promptText: string): ParsedUserRequest {
  const match = promptText.match(/<user-request>\s*([\s\S]*?)\s*<\/user-request>/i)
  if (!match) return EMPTY_REQUEST

  let rawArg = match[1].trim()
  if (!rawArg) return EMPTY_REQUEST

  const worktreeMatch = rawArg.match(WORKTREE_FLAG_PATTERN)
  const explicitWorktreePath = worktreeMatch ? (worktreeMatch[1] ?? null) : null

  if (worktreeMatch) {
    rawArg = rawArg.replace(worktreeMatch[0], "").trim()
  }

  const makePr = MAKE_PR_FLAG_PATTERN.test(rawArg)
  const ship = SHIP_FLAG_PATTERN.test(rawArg)
  rawArg = rawArg.replace(MAKE_PR_FLAG_PATTERN, "").replace(SHIP_FLAG_PATTERN, "").trim()

  const cleanedArg = rawArg.replace(KEYWORD_PATTERN, "").trim()
  const quotedPlanMatch = cleanedArg.match(WRAPPING_QUOTES_PATTERN)
  const normalizedPlanName = quotedPlanMatch ? quotedPlanMatch[2].trim() : cleanedArg

  return {
    planName: normalizedPlanName || null,
    explicitWorktreePath,
    makePr,
    ship,
  }
}
