import type { ResolvedSpawnItem } from "./types"

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

type SpawnItemInput = TargetInput & {
  readonly prompt: string
  readonly description?: string
  readonly name?: string
  readonly model?: string
  readonly load_skills?: readonly string[]
}

type SpawnParamsInput = TargetInput & {
  readonly description?: string
  readonly name?: string
  readonly model?: string
  readonly load_skills?: readonly string[]
  readonly run_in_background?: boolean
  readonly tasks?: readonly SpawnItemInput[]
}

export type BatchShapeErrorCode = "prompt_and_tasks" | "no_prompt_or_tasks" | "empty_tasks"

export type BatchShapeError = {
  readonly code: BatchShapeErrorCode
  readonly message: string
}

export type BatchShapeResult =
  | { readonly kind: "single" }
  | { readonly kind: "batch" }
  | { readonly kind: "error"; readonly error: BatchShapeError }

export type SpawnItemTargetError = {
  readonly code: "item_target"
  readonly index: number
  readonly message: string
}

export type ResolveSpawnItemsResult =
  | { readonly kind: "ok"; readonly items: readonly ResolvedSpawnItem[] }
  | { readonly kind: "error"; readonly error: BatchShapeError | SpawnItemTargetError }

const BOTH_TARGETS_MESSAGE = "Provide EITHER category OR subagent_type, not both. Remove one and retry."

const NO_TARGET_MESSAGE =
  'You MUST provide EITHER category OR subagent_type. Omitting BOTH will FAIL. Example: task(category="quick", prompt="...") or task(subagent_type="oracle", prompt="...").'

const PROMPT_AND_TASKS_MESSAGE = "Provide EITHER prompt OR tasks, not both. Remove one and retry."

const NO_PROMPT_OR_TASKS_MESSAGE = "Provide EITHER prompt OR tasks. One field is required."

const EMPTY_TASKS_MESSAGE = "tasks must contain at least one item."

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

export function validateBatchShape(params: SpawnParamsInput): BatchShapeResult {
  const hasPrompt = params.prompt !== undefined
  const hasTasks = params.tasks !== undefined
  if (hasPrompt && hasTasks) {
    return { kind: "error", error: { code: "prompt_and_tasks", message: PROMPT_AND_TASKS_MESSAGE } }
  }
  if (!hasPrompt && !hasTasks) {
    return { kind: "error", error: { code: "no_prompt_or_tasks", message: NO_PROMPT_OR_TASKS_MESSAGE } }
  }
  if (params.tasks !== undefined && params.tasks.length === 0) {
    return { kind: "error", error: { code: "empty_tasks", message: EMPTY_TASKS_MESSAGE } }
  }
  return hasTasks ? { kind: "batch" } : { kind: "single" }
}

export function resolveSpawnItems(params: SpawnParamsInput): ResolveSpawnItemsResult {
  const shape = validateBatchShape(params)
  if (shape.kind === "error") return shape

  const inputs: readonly SpawnItemInput[] =
    params.tasks ??
    (params.prompt === undefined
      ? []
      : [
          {
            prompt: params.prompt,
            ...(params.description === undefined ? {} : { description: params.description }),
            ...(params.name === undefined ? {} : { name: params.name }),
          },
        ])
  const items: ResolvedSpawnItem[] = []

  for (const [index, input] of inputs.entries()) {
    const itemDefinesCategory = input.category !== undefined
    const itemDefinesSubagent = input.subagent_type !== undefined
    const category = itemDefinesCategory ? input.category : itemDefinesSubagent ? undefined : params.category
    const subagentType = itemDefinesSubagent
      ? input.subagent_type
      : itemDefinesCategory
        ? undefined
        : params.subagent_type
    const target = validateTaskTarget({ category, subagent_type: subagentType })
    if (target.kind === "error") {
      return {
        kind: "error",
        error: {
          code: "item_target",
          index,
          message: `Task item ${index}: ${target.error.message}`,
        },
      }
    }

    const model = input.model ?? params.model
    const common = {
      prompt: input.prompt,
      load_skills: input.load_skills ?? params.load_skills ?? [],
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(model === undefined ? {} : { model }),
    }
    if (target.kind === "category") {
      items.push({ ...common, kind: "category", category: target.category })
    } else {
      items.push({ ...common, kind: "subagent_type", subagentType: target.subagentType })
    }
  }

  return { kind: "ok", items }
}
