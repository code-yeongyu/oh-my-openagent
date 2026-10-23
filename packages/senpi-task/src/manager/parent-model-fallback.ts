import type { ParentModelFallback, ParentModelFallbackReason, TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import type { ManagedChildEvent, ManagedChildHandle } from "./child-handle"
import { isCredentialFailure, usageLimitScope } from "./credential-failure"
import { isParentModelRung } from "./parent-model-rung"

const DETAIL_MAX = 200
const RESETS = /\bresets?\s+((?:at|in)\s+)?([^.\n;]+)/iu

export type FailedTurn = {
  readonly message: string
  readonly tools: readonly string[]
}

// The failure itself outranks the engine's hop label: senpi can route an account limit it retried through
// its transient lane, and the row must still say "usage limit".
function reasonOfEngineFallback(event: ManagedChildEvent, detail: string | undefined): ParentModelFallbackReason {
  if (readString(event, "limit") !== undefined) return "usage_limit"
  if (detail !== undefined && reasonOfFailure(detail) !== "error") return reasonOfFailure(detail)
  switch (readString(event, "reason")) {
    case "billing":
      return "usage_limit"
    case "refusal":
      return "refused"
    case "transient":
      return "unavailable"
    default:
      return "error"
  }
}

export function reasonOfFailure(message: string, modelId?: string): ParentModelFallbackReason {
  if (usageLimitScope(message) !== undefined) return "usage_limit"
  if (isCredentialFailure(message, modelId)) return "not_signed_in"
  return "error"
}

export function startFallbackToParent(record: Pick<TaskRecord, "model" | "resolved_model">, message: string, at: string): ParentModelFallback {
  const reason = reasonOfFailure(message, record.resolved_model?.model_id)
  return buildParentModelFallback({ fromModel: record.model, reason: reason === "error" ? "unavailable" : reason, message, at })
}

export function buildParentModelFallback(input: {
  readonly fromModel: string
  readonly reason: ParentModelFallbackReason
  readonly message?: string
  readonly interruptedTools?: readonly string[]
  readonly at: string
}): ParentModelFallback {
  const detail = input.message === undefined ? undefined : firstLine(input.message)
  const resets = input.message === undefined ? undefined : resetsOf(input.message)
  return {
    from_model: input.fromModel,
    reason: input.reason,
    at: input.at,
    ...(detail === undefined ? {} : { detail }),
    ...(resets === undefined ? {} : { resets }),
    ...(input.interruptedTools === undefined || input.interruptedTools.length === 0 ? {} : { interrupted_tools: input.interruptedTools }),
  }
}

/**
 * Stamp `parent_model_fallback` when the child's own in-session fallback lands on the parent session's
 * model. The failed turn that caused it is remembered from its error message: the provider's words, the
 * reset time they name, and any tool call the model was still writing - that call never ran, and the
 * row says so instead of letting the next model silently redo it.
 */
export function observeParentModelFallback(input: {
  readonly handle: ManagedChildHandle
  readonly store: TaskRecordStore
  readonly taskId: string
  readonly now: () => number
  // The last failed turn per child, shared with the manager's own restart walk (#10750).
  readonly failedTurns: WeakMap<ManagedChildHandle, FailedTurn>
}): (event: ManagedChildEvent) => void {
  const { handle, store, taskId, now, failedTurns } = input
  let streamedTools: readonly string[] = []
  return (event) => {
    if (event.type === "message_start") streamedTools = []
    if (event.type === "message_update" && isAssistant(event.message)) streamedTools = toolCallNames(event.message)
    if (event.type === "message_end" && isAssistant(event.message)) {
      const turn = failedTurnOf(event.message, streamedTools)
      if (turn === undefined) failedTurns.delete(handle)
      else failedTurns.set(handle, turn)
      return
    }
    if (event.type !== "retry_fallback_applied") return
    const to = readString(event, "to")
    const record = store.load(taskId)
    if (to === undefined || record == null || !isParentModelRung(record, to)) return
    const failed = failedTurns.get(handle)
    const fallback = buildParentModelFallback({
      fromModel: baseSelector(readString(event, "from") ?? record.model),
      reason: reasonOfEngineFallback(event, failed?.message),
      ...(failed === undefined ? {} : { message: failed.message, interruptedTools: failed.tools }),
      at: new Date(now()).toISOString(),
    })
    failedTurns.delete(handle)
    store.mutate(taskId, (fresh) => ({ ...fresh, parent_model_fallback: fallback }))
  }
}

// The engine drops a cut-off tool call from the final error message, so the calls the stream had
// already opened are what the turn was still writing.
function failedTurnOf(message: Record<string, unknown>, streamedTools: readonly string[]): FailedTurn | undefined {
  if (message.stopReason !== "error" && message.stopReason !== "aborted") return undefined
  const text = typeof message.errorMessage === "string" && message.errorMessage.length > 0 ? message.errorMessage : undefined
  const tools = [...new Set([...toolCallNames(message), ...streamedTools])]
  return { message: text ?? `stopped with ${String(message.stopReason)}`, tools }
}

function toolCallNames(message: Record<string, unknown>): readonly string[] {
  return Array.isArray(message.content) ? message.content.flatMap((part: unknown) => isToolCall(part) ? [part.name] : []) : []
}

function isAssistant(message: unknown): message is Record<string, unknown> {
  return typeof message === "object" && message !== null && Reflect.get(message, "role") === "assistant"
}

function isToolCall(part: unknown): part is { readonly name: string } {
  return typeof part === "object" && part !== null && Reflect.get(part, "type") === "toolCall" && typeof Reflect.get(part, "name") === "string"
}

function readString(event: ManagedChildEvent, key: string): string | undefined {
  const value = Reflect.get(event, key)
  return typeof value === "string" ? value : undefined
}

function firstLine(message: string): string | undefined {
  const line = message.split("\n").map((part) => part.trim()).find((part) => part.length > 0)
  if (line === undefined) return undefined
  return line.length > DETAIL_MAX ? `${line.slice(0, DETAIL_MAX - 1)}…` : line
}

function resetsOf(message: string): string | undefined {
  const match = RESETS.exec(message)
  const when = withoutUnbalancedParen(match?.[2]?.trim())
  return when === undefined || when.length === 0 ? undefined : `${match?.[1] ?? ""}${when}`
}

// `(resets 3:20am)` closes a parenthesis the match never opened; `resets 3pm (Asia/Seoul)` keeps its own.
function withoutUnbalancedParen(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const opened = value.split("(").length - 1
  const closed = value.split(")").length - 1
  return closed > opened && value.endsWith(")") ? value.slice(0, -1).trim() : value
}

function baseSelector(selector: string): string {
  const slash = selector.indexOf("/")
  const colon = selector.lastIndexOf(":")
  return colon > slash ? selector.slice(0, colon) : selector
}
