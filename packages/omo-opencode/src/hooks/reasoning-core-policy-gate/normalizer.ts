import type { CandidateAction } from "./types"

export function normalizeCandidateAction(
  tool: string,
  sessionID: string,
  args: Record<string, unknown>,
  agentKey?: string,
): CandidateAction {
  const subagentType = typeof args.subagent_type === "string"
    ? args.subagent_type
    : undefined

  const candidate: CandidateAction = {
    tool,
    sessionID,
    args,
  }

  if (typeof agentKey === "string") {
    candidate.agent = agentKey
  }

  if (subagentType) {
    candidate.context = { subagentType }
  }

  return candidate
}
