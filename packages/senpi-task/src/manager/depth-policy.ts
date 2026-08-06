export type DepthPolicyInput = {
  readonly childDepth: number
  readonly maxDepth: number
  readonly targetAgentType?: string
  readonly allowedSubagents?: readonly string[]
}

export type DepthDecision =
  | { readonly allowed: true; readonly reason: "within-depth" | "allowed-subagent" }
  | { readonly allowed: false; readonly reason: string }

// pi-task task-policy parity: an explicit allowed_subagents entry permits any depth; otherwise the
// child is admitted only while its depth stays within maxDepth (default 1 comes from the caller).
export function decideDepthPolicy(input: DepthPolicyInput): DepthDecision {
  if (
    input.targetAgentType !== undefined &&
    input.allowedSubagents !== undefined &&
    input.allowedSubagents.includes(input.targetAgentType)
  ) {
    return { allowed: true, reason: "allowed-subagent" }
  }

  if (input.childDepth <= input.maxDepth) {
    return { allowed: true, reason: "within-depth" }
  }

  return {
    allowed: false,
    reason: `Task nesting depth ${input.childDepth} exceeds maxDepth ${input.maxDepth}.`,
  }
}
