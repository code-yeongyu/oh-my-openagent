import type { ResolvedSpawnItem } from "./types"

export type TaskTargetErrorCode = "both_targets" | "no_target" | "category_with_model"

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
  readonly model?: string
}

type SpawnItemInput = TargetInput & {
  readonly prompt?: string
  readonly task_summary?: string
  readonly description?: string
  readonly name?: string
  readonly model?: string
  readonly load_skills?: readonly string[]
}

type SpawnParamsInput = TargetInput & {
  readonly task_summary?: string
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

// One rejected batch item: which index, which field, and why. Reported for EVERY offending item in
// the call so the caller never has to re-submit one index at a time.
export type SpawnItemRejection = {
  readonly index: number
  readonly field: string
  readonly reason: string
}

// `accepted` counts the items that passed validation and WOULD have spawned; the call is still
// rejected atomically, so nothing actually spawns. Carrying it makes the caller-side accounting
// invariant accepted + rejected == submitted checkable directly from the error.
export type SpawnItemsInvalidError = {
  readonly code: "invalid_items"
  readonly rejected: readonly SpawnItemRejection[]
  readonly accepted: number
  readonly submitted: number
  readonly message: string
}

export type ResolveSpawnItemsResult =
  | { readonly kind: "ok"; readonly items: readonly ResolvedSpawnItem[] }
  | { readonly kind: "error"; readonly error: BatchShapeError | SpawnItemTargetError | SpawnItemsInvalidError }

const BOTH_TARGETS_MESSAGE = "Provide EITHER category OR subagent_type, not both. Remove one and retry."

const CATEGORY_WITH_MODEL_MESSAGE =
  "Provide EITHER category OR model, never both. A category-routed task always takes its model from the omo.json category config; a call-site model override would silently bypass that routing. Remove model and retry, or use subagent_type for an explicit-model spawn, or configure categories.<name>.models in omo.json."

const NO_TARGET_MESSAGE =
  'You MUST provide EITHER category OR subagent_type. Omitting BOTH will FAIL. Example: task(category="quick", prompt="...") or task(subagent_type="momus", prompt="...").'

const PROMPT_AND_TASKS_MESSAGE = "Provide EITHER prompt OR tasks, not both. Remove one and retry."

const NO_PROMPT_OR_TASKS_MESSAGE = "Provide EITHER prompt OR tasks. One field is required."

const EMPTY_TASKS_MESSAGE = "tasks must contain at least one item."

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0
}

const MISSING_PROMPT_REASON = "prompt is required and must be non-empty"

function targetErrorField(code: TaskTargetErrorCode): string {
  switch (code) {
    case "both_targets":
      return "category+subagent_type"
    case "category_with_model":
      return "category+model"
    case "no_target":
      return "category|subagent_type"
  }
}

// The call is rejected atomically: nothing is spawned, so the caller can fix every named index and
// resubmit the whole batch. Reporting the submitted count next to the rejected list makes the
// accepted + rejected == submitted accounting checkable from the message alone.
function invalidItemsMessage(rejected: readonly SpawnItemRejection[], submitted: number): string {
  const details = rejected.map((entry) => `item ${entry.index} (${entry.field}: ${entry.reason})`).join("; ")
  return `Rejected ${rejected.length} of ${submitted} task items; nothing was spawned. Fix and resubmit the whole batch. Invalid: ${details}.`
}

// category XOR subagent_type: both or neither is a typed tool error. Wording ports the omo
// delegate-task tool-description contract so the model sees the same guidance it does in OpenCode.
export function validateTaskTarget(params: TargetInput): TaskTargetSelection {
  const hasCategory = present(params.category)
  const hasSubagent = present(params.subagent_type)
  if (hasCategory && hasSubagent) {
    return { kind: "error", error: { code: "both_targets", message: BOTH_TARGETS_MESSAGE } }
  }
  if (hasCategory && present(params.model)) {
    return { kind: "error", error: { code: "category_with_model", message: CATEGORY_WITH_MODEL_MESSAGE } }
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
  const isBatch = shape.kind === "batch"

  const inputs: readonly SpawnItemInput[] =
    params.tasks ??
    (params.prompt === undefined
      ? []
      : [
          {
            prompt: params.prompt,
            ...(params.task_summary === undefined ? {} : { task_summary: params.task_summary }),
            ...(params.description === undefined ? {} : { description: params.description }),
            ...(params.name === undefined ? {} : { name: params.name }),
          },
        ])
  const items: ResolvedSpawnItem[] = []
  const rejected: SpawnItemRejection[] = []

  for (const [index, input] of inputs.entries()) {
    const itemDefinesCategory = input.category !== undefined
    const itemDefinesSubagent = input.subagent_type !== undefined
    const category = itemDefinesCategory ? input.category : itemDefinesSubagent ? undefined : params.category
    const subagentType = itemDefinesSubagent
      ? input.subagent_type
      : itemDefinesCategory
        ? undefined
        : params.subagent_type
    const effectiveModel = input.model ?? params.model

    // A batch collects EVERY fault before returning, so the reported set never depends on item
    // order and the caller fixes the whole call once. A single spawn keeps its typed first-error
    // contract, which execute.ts and the tool surface already depend on.
    if (!present(input.prompt)) {
      if (!isBatch) {
        return { kind: "error", error: { code: "no_prompt_or_tasks", message: NO_PROMPT_OR_TASKS_MESSAGE } }
      }
      rejected.push({ index, field: "prompt", reason: MISSING_PROMPT_REASON })
      continue
    }

    // Inheritance is applied BEFORE validation, so an item that is valid only once it picks up the
    // top-level category/subagent_type/model is never wrongly rejected.
    const target = validateTaskTarget({ category, subagent_type: subagentType, model: effectiveModel })
    if (target.kind === "error") {
      if (isBatch) {
        rejected.push({ index, field: targetErrorField(target.error.code), reason: target.error.message })
        continue
      }
      return {
        kind: "error",
        error: {
          code: "item_target",
          index,
          message: `Task item ${index}: ${target.error.message}`,
        },
      }
    }

    const model = effectiveModel
    const common = {
      prompt: input.prompt,
      load_skills: input.load_skills ?? params.load_skills ?? [],
      ...(input.task_summary === undefined ? {} : { task_summary: input.task_summary }),
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

  // Atomic: a single invalid item rejects the whole call and spawns nothing, matching how every
  // other malformed-input path on this tool surface reports invalid_arguments.
  if (rejected.length > 0) {
    return {
      kind: "error",
      error: {
        code: "invalid_items",
        rejected,
        accepted: items.length,
        submitted: inputs.length,
        message: invalidItemsMessage(rejected, inputs.length),
      },
    }
  }

  return { kind: "ok", items }
}
