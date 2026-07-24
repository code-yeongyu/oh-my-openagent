import {
  decideSpawnAdmission,
  type SpawnCallerRole,
  type SpawnLineage,
  type SpawnPolicyDecision,
} from "@oh-my-opencode/delegate-core"

export const SENPI_MAX_CHILD_DEPTH = 1

export type DepthPolicyInput = {
  readonly childDepth: number
  readonly maxDepth: number
  readonly targetAgentType?: string
  readonly callerRole: SpawnCallerRole
  readonly callerMaxDepth?: number
  readonly lineage: SpawnLineage
  readonly allowedSubagents?: readonly string[]
}

export type DepthDecision = SpawnPolicyDecision

export function decideDepthPolicy(input: DepthPolicyInput): DepthDecision {
  return decideSpawnAdmission({
    currentDepth: input.childDepth - 1,
    configuredMaxDepth: Math.min(input.maxDepth, SENPI_MAX_CHILD_DEPTH),
    callerRole: input.callerRole,
    lineage: input.lineage,
    targetAgent: input.targetAgentType ?? "unspecified",
    ...(input.callerMaxDepth !== undefined ? { callerMaxDepth: input.callerMaxDepth } : {}),
    ...(input.allowedSubagents !== undefined ? { allowedSubagents: input.allowedSubagents } : {}),
  })
}
