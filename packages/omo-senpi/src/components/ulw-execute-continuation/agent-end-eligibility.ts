import { isRefusalLikeMessage } from "../fallback-architect/detection"

/**
 * Terminal-outcome gate for both plan-continuation producers.
 *
 * Continuation is not error recovery: Senpi owns retries, fallback, compaction and abort handling.
 * The admitted shapes are the INTERSECTION of the two gates the pinned host already ships for the
 * same question (`@code-yeongyu/senpi` 2026.9.10):
 *
 * - `AgentSession._agentEndAllowsQueuedContinuation` (`dist/core/agent-session.js`): requires a last
 *   assistant message, rejects `aborted`/`error` stops, rejects a turn the host is holding for
 *   required auto-compaction, and rejects when any `toolResult` AFTER that assistant is an error
 *   whose text matches `/\babort(?:ed)?\b/i`.
 * - builtin goal `didAgentEndCleanly` (`dist/core/extensions/builtin/goal/continuation.js`): accepts
 *   `stop`/`length` plus a MALFORMED `toolUse` turn (`isMalformedToolUseTurn`: no `toolCall` content,
 *   or `stop` carrying the empty-tool-use demotion diagnostic), and applies the same trailing
 *   aborted-`toolResult` rejection.
 *
 * A `toolUse` turn that still carries tool calls is a run stopped mid-tool-execution, not a finished
 * turn, so it is rejected exactly like the host rejects it.
 *
 * Required auto-compaction is NOT decided here: it is unobservable from an `agent_end` payload
 * (`_getRequiredAutoCompactionReason` reads provider usage against the host's adaptive threshold).
 * Both producers therefore record this outcome at `agent_end` and act on `agent_settled`, the event
 * the host defines as "no automatic retry, compaction, or queued continuation will run"
 * (`dist/core/extensions/types.d.ts` `AgentSettledEvent`).
 */
export type ContinuationBlockReason =
  | "aborted"
  | "host-retry"
  | "missing-outcome"
  | "refusal"
  | "unfinished-turn"
  | "aborted-tool-result"

export interface AgentEndOutcome {
  readonly stopReason: string | null
  readonly aborted: boolean
  readonly willRetry: boolean
  /** null when the outcome is continuable; otherwise the single reason that blocked it. */
  readonly blockedBy: ContinuationBlockReason | null
}

export function readAgentEndOutcome(payload: unknown): AgentEndOutcome {
  if (!isRecord(payload)) return { stopReason: null, aborted: false, willRetry: false, blockedBy: "missing-outcome" }
  // Read at decision time, never cached: on a late user abort the host mutates THIS event object in
  // place (`dist/core/agent-abort-provenance.js` `join`) for as long as the agent_end boundary is
  // open, which includes the whole agent_settled emit.
  const aborted = payload["aborted"] === true
  const willRetry = payload["willRetry"] === true
  const messages = payload["messages"]
  const assistantIndex = Array.isArray(messages) ? lastAssistantIndex(messages) : -1
  const assistant: unknown = assistantIndex === -1 ? undefined : (messages as unknown[])[assistantIndex]
  const stopReason = isRecord(assistant) && typeof assistant["stopReason"] === "string" ? assistant["stopReason"] : null
  const outcome = { stopReason, aborted, willRetry }

  if (aborted) return { ...outcome, blockedBy: "aborted" }
  if (willRetry) return { ...outcome, blockedBy: "host-retry" }
  if (!isRecord(assistant) || stopReason === null) return { ...outcome, blockedBy: "missing-outcome" }
  if (isRefusalLikeMessage(assistant)) return { ...outcome, blockedBy: "refusal" }
  if (!isFinishedAssistantTurn(assistant, stopReason)) return { ...outcome, blockedBy: "unfinished-turn" }
  if ((messages as unknown[]).slice(assistantIndex + 1).some(isAbortedToolResult)) {
    return { ...outcome, blockedBy: "aborted-tool-result" }
  }
  return { ...outcome, blockedBy: null }
}

export function canContinueAfterAgentEnd(payload: unknown): boolean {
  return readAgentEndOutcome(payload).blockedBy === null
}

function isFinishedAssistantTurn(assistant: Record<string, unknown>, stopReason: string): boolean {
  if (stopReason === "stop" || stopReason === "length") return true
  return stopReason === "toolUse" && !hasToolCallContent(assistant)
}

function hasToolCallContent(assistant: Record<string, unknown>): boolean {
  const content = assistant["content"]
  if (!Array.isArray(content)) return false
  return content.some((block: unknown) => isRecord(block) && block["type"] === "toolCall")
}

// Mirrors the host's `isAbortedToolResult`: an error result whose text names an abort. Senpi writes
// those when a tool run is cancelled mid-flight, so they mark an interrupted turn even when the
// assistant message itself looks finished.
function isAbortedToolResult(message: unknown): boolean {
  if (!isRecord(message) || message["role"] !== "toolResult" || message["isError"] !== true) return false
  const content = message["content"]
  if (!Array.isArray(content)) return false
  return content.some(
    (block: unknown) =>
      isRecord(block) && block["type"] === "text" && typeof block["text"] === "string" && /\babort(?:ed)?\b/i.test(block["text"]),
  )
}

function lastAssistantIndex(messages: readonly unknown[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (isRecord(message) && message["role"] === "assistant") return index
  }
  return -1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
