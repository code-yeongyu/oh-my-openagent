export const SPAWN_POLICY_VERSION = 1 as const
export const SPAWN_POLICY_GLOBAL_MAX_DEPTH = 2 as const
export const SPAWN_CALLER_ROLES = [
  "coordinator", "planning_coordinator", "worker", "reviewer", "specialist", "team_member", "leaf",
] as const

export type SpawnCallerRole = (typeof SPAWN_CALLER_ROLES)[number]
export type SpawnLineage = "known" | "unknown" | "cyclic"
export type SpawnPolicyInvalidField = "currentDepth" | "configuredMaxDepth" | "callerMaxDepth"
export type SpawnPolicyInput = {
  readonly currentDepth: number
  readonly lineage: SpawnLineage
  readonly callerRole: SpawnCallerRole
  readonly targetAgent: string
  readonly configuredMaxDepth?: number
  readonly callerMaxDepth?: number
  readonly allowedSubagents?: readonly string[]
}

type EvaluatedDecisionFields = {
  readonly policyVersion: typeof SPAWN_POLICY_VERSION
  readonly childDepth: number
  readonly effectiveMaxDepth: number
}

export type SpawnPolicyDecision =
  | ({ readonly allowed: true } & EvaluatedDecisionFields)
  | ({ readonly allowed: false; readonly code: "spawn_denied"; readonly reason: "caller_not_allowed" | "depth_exceeded" | "unknown_lineage" | "target_not_allowed" } & EvaluatedDecisionFields)
  | { readonly allowed: false; readonly code: "spawn_denied"; readonly reason: "invalid_policy"; readonly policyVersion: typeof SPAWN_POLICY_VERSION; readonly invalidField: SpawnPolicyInvalidField }

const ROLE_CAN_SPAWN = {
  coordinator: true,
  planning_coordinator: true,
  worker: false,
  reviewer: false,
  specialist: false,
  team_member: false,
  leaf: false,
} as const satisfies Record<SpawnCallerRole, boolean>

function invalidPolicy(invalidField: SpawnPolicyInvalidField): SpawnPolicyDecision {
  return { allowed: false, code: "spawn_denied", reason: "invalid_policy", policyVersion: SPAWN_POLICY_VERSION, invalidField }
}

function isValidMaximum(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= SPAWN_POLICY_GLOBAL_MAX_DEPTH
}

function deny(
  reason: "caller_not_allowed" | "depth_exceeded" | "unknown_lineage" | "target_not_allowed",
  fields: EvaluatedDecisionFields,
): SpawnPolicyDecision {
  return { allowed: false, code: "spawn_denied", reason, ...fields }
}

export function decideSpawnAdmission(input: SpawnPolicyInput): SpawnPolicyDecision {
  if (!Number.isInteger(input.currentDepth) || input.currentDepth < 0) return invalidPolicy("currentDepth")
  const configuredMaxDepth = input.configuredMaxDepth ?? 1
  if (!isValidMaximum(configuredMaxDepth)) return invalidPolicy("configuredMaxDepth")
  const callerMaxDepth = input.callerMaxDepth ?? SPAWN_POLICY_GLOBAL_MAX_DEPTH
  if (!isValidMaximum(callerMaxDepth)) return invalidPolicy("callerMaxDepth")
  const fields = {
    policyVersion: SPAWN_POLICY_VERSION,
    childDepth: input.currentDepth + 1,
    effectiveMaxDepth: Math.min(configuredMaxDepth, callerMaxDepth, SPAWN_POLICY_GLOBAL_MAX_DEPTH),
  } as const
  if (input.lineage !== "known") return deny("unknown_lineage", fields)
  if (!ROLE_CAN_SPAWN[input.callerRole]) return deny("caller_not_allowed", fields)
  if (input.allowedSubagents !== undefined && !input.allowedSubagents.includes(input.targetAgent)) {
    return deny("target_not_allowed", fields)
  }
  if (fields.childDepth > fields.effectiveMaxDepth) return deny("depth_exceeded", fields)
  return { allowed: true, ...fields }
}
