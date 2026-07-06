export type TaskTargetErrorCode = "both_targets" | "no_target"

export type TaskTargetError = {
  readonly code: TaskTargetErrorCode
  readonly message: string
}

export type TaskTargetSelection =
  | { readonly kind: "category"; readonly category: string }
  | { readonly kind: "subagent_type"; readonly subagentType: string }
  | { readonly kind: "error"; readonly error: TaskTargetError }

type TargetInput = {
  readonly prompt?: string
  readonly category?: string
  readonly subagent_type?: string
}

const BOTH_TARGETS_MESSAGE =
  "Provide EITHER category OR subagent_type, not both. When category is provided, subagent_type is ignored - remove one."

const NO_TARGET_MESSAGE =
  'You MUST provide EITHER category OR subagent_type. Omitting BOTH will FAIL. Example: task(category="quick", prompt="...") or task(subagent_type="oracle", prompt="...").'

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0
}

// category XOR subagent_type: both or neither is a typed tool error. Wording ports the omo
// delegate-task tool-description contract so the model sees the same guidance it does in OpenCode.
export function validateTaskTarget(params: TargetInput): TaskTargetSelection {
  const hasCategory = present(params.category)
  const hasSubagent = present(params.subagent_type)
  if (hasCategory && hasSubagent) {
    return { kind: "error", error: { code: "both_targets", message: BOTH_TARGETS_MESSAGE } }
  }
  if (present(params.category)) {
    return { kind: "category", category: params.category.trim() }
  }
  if (present(params.subagent_type)) {
    return { kind: "subagent_type", subagentType: params.subagent_type.trim() }
  }
  return { kind: "error", error: { code: "no_target", message: NO_TARGET_MESSAGE } }
}
