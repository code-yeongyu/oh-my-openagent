export type ChildSessionEvent = {
  readonly type: string
  readonly message?: unknown
}

export type ChildSessionListener = (event: ChildSessionEvent) => void

// Structural subset of senpi's AgentSession that the handle drives. The default seam returns a
// live AgentSession; fakes implement only these members.
export type ChildSession = {
  readonly sessionId: string
  prompt(text: string): Promise<void>
  steer(text: string): Promise<void>
  followUp(text: string): Promise<void>
  abort(): Promise<void>
  subscribe(listener: ChildSessionListener): () => void
  getLastAssistantText(): string | undefined
  dispose(): void
}

export type RunnerFailure = {
  readonly kind: "child-prompt-failed" | "child-turn-failed" | "session-create-failed" | "depth-exceeded"
  readonly message: string
  readonly cause?: unknown
}

export type RunnerOutcome =
  | { readonly status: "completed"; readonly finalResponse: string }
  | { readonly status: "error"; readonly failure: RunnerFailure; readonly killed?: boolean }
  | { readonly status: "cancelled" }

export type ChildHandle = {
  readonly task_id: string
  readonly sessionId: string
  steer(text: string): Promise<void>
  followUp(text: string): Promise<void>
  abort(): Promise<void>
  subscribe(listener: ChildSessionListener): () => void
  waitForIdle(): Promise<RunnerOutcome>
  lastAssistantText(): string | undefined
  dispose(): void
}

export type CreateChildHandleInput = {
  readonly taskId: string
  readonly session: ChildSession
  readonly promptText: string
}

// Per-turn facts observed from the session's event stream. senpi surfaces provider/stream failures
// as an assistant message with stopReason "error"/"aborted" + errorMessage while prompt() resolves
// cleanly, so the turn outcome must be derived from what the turn actually EMITTED, never assumed
// from prompt() resolution alone (the silent-empty-completion bug).
type TurnObservation = {
  text: string | undefined
  stopReason: string | undefined
  errorMessage: string | undefined
  baseline: string | undefined
}

function observeTurnEvent(observation: TurnObservation, event: ChildSessionEvent): void {
  if (event.type !== "message_end") return
  const message = event.message
  if (!isRecord(message) || message.role !== "assistant") return
  const text = assistantText(message)
  if (text !== undefined) observation.text = text
  observation.stopReason = typeof message.stopReason === "string" ? message.stopReason : undefined
  observation.errorMessage = typeof message.errorMessage === "string" ? message.errorMessage : undefined
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
function turnOutcome(session: ChildSession, observation: TurnObservation): RunnerOutcome {
  if (observation.stopReason === "error" || observation.stopReason === "aborted") {
    return {
      status: "error",
      failure: {
        kind: "child-turn-failed",
        message: observation.errorMessage ?? `child turn ended with stopReason "${observation.stopReason}"`,
      },
    }
  }
  if (observation.text !== undefined) return { status: "completed", finalResponse: observation.text }
  const final = session.getLastAssistantText()
  if (final !== undefined && final.length > 0 && final !== observation.baseline) {
    return { status: "completed", finalResponse: final }
  }
  return {
    status: "error",
    failure: {
      kind: "child-turn-failed",
      message: observation.errorMessage ?? "child turn produced no assistant output",
    },
  }
}

// A prompt turn is a TRACKED async op: the promise is created and its rejection handled at the
// call site, so steering can happen WHILE it runs and no rejection ever escapes. The same routine
// drives the initial prompt and every revive follow-up (a fresh turn on an idle resident session).
async function runTurn(
  session: ChildSession,
  text: string,
  isAborted: () => boolean,
  observation: TurnObservation,
): Promise<RunnerOutcome> {
  try {
    await session.prompt(text)
  } catch (error) {
    if (isAborted()) return { status: "cancelled" }
    if (error instanceof Error) {
      return {
        status: "error",
        failure: { kind: "child-prompt-failed", message: error.message, cause: error },
      }
    }
    const message = String(error)
    return {
      status: "error",
      failure: { kind: "child-prompt-failed", message, cause: error },
    }
  }
  if (isAborted()) return { status: "cancelled" }
  return turnOutcome(session, observation)
}

export function createChildHandle(input: CreateChildHandleInput): ChildHandle {
  const { session } = input
  let aborted = false
  let disposed = false
  let turnActive = false
  let running: Promise<RunnerOutcome>
  const observation: TurnObservation = { text: undefined, stopReason: undefined, errorMessage: undefined, baseline: undefined }
  const unsubscribeObserver = session.subscribe((event) => observeTurnEvent(observation, event))

  // Start a fresh tracked turn and mark it active until it settles. waitForIdle() always returns the
  // CURRENT turn, so a revive follow-up re-arms it to the new turn instead of a stale resolved one.
  const beginTurn = (text: string): void => {
    aborted = false
    turnActive = true
    observation.text = undefined
    observation.stopReason = undefined
    observation.errorMessage = undefined
    observation.baseline = session.getLastAssistantText()
    running = runTurn(session, text, () => aborted, observation)
    void running.then(
      () => {
        turnActive = false
      },
      () => {
        turnActive = false
      },
    )
  }

  beginTurn(input.promptText)

  return {
    task_id: input.taskId,
    sessionId: session.sessionId,
    steer: (text) => session.steer(text),
    followUp: async (text) => {
      // While a turn is running, a follow-up is queued and delivered when the agent settles. Once
      // the child is idle/resident, a follow-up REVIVES it: drive a fresh turn and re-arm tracking.
      if (turnActive) {
        await session.followUp(text)
        return
      }
      beginTurn(text)
    },
    abort: async () => {
      aborted = true
      await session.abort()
    },
    subscribe: (listener) => session.subscribe(listener),
    waitForIdle: () => running,
    lastAssistantText: () => session.getLastAssistantText(),
    dispose: () => {
      if (disposed) return
      disposed = true
      unsubscribeObserver()
      session.dispose()
    },
  }
}
