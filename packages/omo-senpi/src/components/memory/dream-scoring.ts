export interface DreamScoreOperands {
  readonly searchHits: number
  readonly unreflectedSteps: number
  readonly recency: number
  readonly sourceCount: number
  readonly sizeFit: number
  readonly isCurrent: number
  readonly penalty: number
}

export interface DreamScoredConversation {
  readonly conversationId: string
  readonly totalBytes: number
  readonly lastActivityMs: number
  readonly operands: DreamScoreOperands
  readonly score: number
}

export interface DreamSelection {
  readonly conversationIds: readonly string[]
  readonly totalBytes: number
}

export interface DreamScoreInput {
  readonly searchMatchCount: number
  readonly stepsSinceLastSuccessfulReflection: number
  readonly lastActivity: string
  readonly distinctSourceCount: number
  readonly totalBytes: number
  readonly targetBytes: number
  readonly isCurrent: boolean
  readonly newestMessageCovered: boolean
  readonly now: Date
}

export function scoreDreamCandidate(input: DreamScoreInput): Pick<DreamScoredConversation, "operands" | "score"> {
  const ageHours = Math.max(0, input.now.getTime() - Date.parse(input.lastActivity)) / 3_600_000
  const recency = Number.isFinite(ageHours) ? Math.min(1, Math.exp(-ageHours / 168)) : 0
  const operands: DreamScoreOperands = {
    searchHits: Math.min(10, Math.max(0, input.searchMatchCount)) / 10,
    unreflectedSteps: Math.min(50, Math.max(0, input.stepsSinceLastSuccessfulReflection)) / 50,
    recency,
    sourceCount: Math.min(200, Math.max(0, input.distinctSourceCount)) / 200,
    sizeFit: input.totalBytes <= input.targetBytes || input.totalBytes === 0
      ? 1
      : Math.min(1, input.targetBytes / input.totalBytes),
    isCurrent: input.isCurrent ? 1 : 0,
    penalty: input.newestMessageCovered ? 1 : 0,
  }
  return {
    operands,
    score: 50 * operands.searchHits
      + operands.unreflectedSteps
      + operands.recency
      + operands.sourceCount
      + operands.sizeFit
      + operands.isCurrent
      - operands.penalty,
  }
}

export function rankDreamCandidates(
  candidates: readonly DreamScoredConversation[],
): DreamScoredConversation[] {
  return [...candidates].sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score
    if (left.operands.unreflectedSteps !== right.operands.unreflectedSteps) {
      return right.operands.unreflectedSteps - left.operands.unreflectedSteps
    }
    if (left.lastActivityMs !== right.lastActivityMs) return right.lastActivityMs - left.lastActivityMs
    return compareConversationIds(left.conversationId, right.conversationId)
  })
}

export function packDreamCandidates(
  ranked: readonly DreamScoredConversation[],
  caps: { readonly maxConversations: number; readonly maxBytes: number },
): DreamSelection {
  const conversationIds: string[] = []
  let totalBytes = 0
  for (const candidate of ranked) {
    if (conversationIds.length >= caps.maxConversations) break
    if (candidate.totalBytes > caps.maxBytes - totalBytes) continue
    conversationIds.push(candidate.conversationId)
    totalBytes += candidate.totalBytes
  }
  return { conversationIds, totalBytes }
}

export function compareConversationIds(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}
