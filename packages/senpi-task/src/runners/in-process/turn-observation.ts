import type { ChildCompletionPolicy, ChildSession, ChildSessionEvent, RunnerOutcome } from "./child-handle"

// Per-turn facts observed from the session's event stream. senpi surfaces provider/stream failures
// as an assistant message with stopReason "error"/"aborted" + errorMessage while prompt() resolves
// cleanly, so the turn outcome must be derived from what the turn actually EMITTED, never assumed
// from prompt() resolution alone (the silent-empty-completion bug).
export type TurnObservation = {
  text: string | undefined
  stopReason: string | undefined
  errorMessage: string | undefined
  provider: string | undefined
  model: string | undefined
  baseline: string | undefined
}

export function observeTurnEvent(observation: TurnObservation, event: ChildSessionEvent): void {
  if (event.type !== "message_end") return
  const message = event.message
  if (!isRecord(message) || message.role !== "assistant") return
  const text = assistantText(message)
  if (text !== undefined) observation.text = text
  observation.stopReason = typeof message.stopReason === "string" ? message.stopReason : undefined
  observation.errorMessage = typeof message.errorMessage === "string" ? message.errorMessage : undefined
  observation.provider = typeof message.provider === "string" ? message.provider : undefined
  observation.model = typeof message.model === "string" ? message.model : undefined
}

function assistantText(message: Record<string, unknown>): string | undefined {
  if (!Array.isArray(message.content)) return undefined
  const text = message.content
    .filter((part: unknown): part is { readonly type: "text"; readonly text: string } => isTextPart(part))
    .map((part) => part.text)
    .join("")
  return text.length > 0 ? text : undefined
}

function isTextPart(part: unknown): part is { readonly type: "text"; readonly text: string } {
  return isRecord(part) && part.type === "text" && typeof part.text === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Derive the settled turn's outcome from what it emitted. The session-level getLastAssistantText()
// is only trusted when it CHANGED during this turn (baseline diff): on a revive, the previous run's
// text must never masquerade as a fresh completion.
export function turnOutcome(session: ChildSession, observation: TurnObservation, completion: ChildCompletionPolicy): RunnerOutcome {
  const provenance = observation.provider !== undefined && observation.model !== undefined
    ? { model: `${observation.provider}/${observation.model}` }
    : {}
  if (observation.stopReason === "error" || observation.stopReason === "aborted") {
    return {
      status: "error",
      ...provenance,
      failure: {
        kind: "child-turn-failed",
        message: observation.errorMessage ?? `child turn ended with stopReason "${observation.stopReason}"`,
      },
    }
  }
  if (observation.text !== undefined) return { status: "completed", finalResponse: observation.text, ...provenance }
  const final = session.getLastAssistantText()
  if (final !== undefined && final.length > 0 && final !== observation.baseline) {
    return { status: "completed", finalResponse: final, ...provenance }
  }
  if (completion === "turn") return { status: "completed", finalResponse: "", ...provenance }
  return {
    status: "error",
    ...provenance,
    failure: {
      kind: "child-turn-failed",
      message: observation.errorMessage ?? "child turn produced no assistant output",
    },
  }
}

// The outcome a restored handle owes waitForIdle() before any follow-up starts a turn: the
// transcript's last assistant text is the honest drain for a child whose completion never reached
// its record (crash between turn end and transition). No text means nothing durable was produced.
export function settledSessionOutcome(session: ChildSession, completion: ChildCompletionPolicy): RunnerOutcome {
  const final = session.getLastAssistantText()
  if (final !== undefined && final.length > 0) return { status: "completed", finalResponse: final }
  if (completion === "turn") return { status: "completed", finalResponse: "" }
  return {
    status: "error",
    failure: { kind: "child-turn-failed", message: "restored session has no assistant output" },
  }
}
