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
  // The snake_case kinds map 1:1 onto the manager's respawn disposition codes (todo 12): a resume
  // rebuild failure is TYPED and retryable, never a silently weakened tool set or transcript.
  readonly kind:
    | "child-prompt-failed"
    | "child-turn-failed"
    | "session-create-failed"
    | "depth-exceeded"
    | "model_unavailable"
    | "tools_unavailable"
    | "session_unavailable"
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

export type CreateRestoredChildHandleInput = {
  readonly taskId: string
  readonly session: ChildSession
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

// Mirrors the RPC runner's terminal-event contract (runners/rpc/handle.ts): ONLY an explicit
// willRetry === false ends the turn. An omitted or malformed flag is not terminal, so a partial
// event can never settle a turn the agent still intends to retry.
function isTerminalAgentEnd(event: unknown): boolean {
  return isRecord(event) && event["willRetry"] === false
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

// The outcome a restored handle owes waitForIdle() before any follow-up starts a turn: the
// transcript's last assistant text is the honest drain for a child whose completion never reached
// its record (crash between turn end and transition). No text means nothing durable was produced.
function settledSessionOutcome(session: ChildSession): RunnerOutcome {
  const final = session.getLastAssistantText()
  if (final !== undefined && final.length > 0) return { status: "completed", finalResponse: final }
  return {
    status: "error",
    failure: { kind: "child-turn-failed", message: "restored session has no assistant output" },
  }
}

type TrackedChildHandle = {
  readonly handle: ChildHandle
  beginTurn(text: string): void
}

function createTrackedChildHandle(taskId: string, session: ChildSession): TrackedChildHandle {
  let aborted = false
  let disposed = false
  let turnActive = false
  // Seeded for the restored case; createChildHandle's beginTurn replaces it immediately.
  let running: Promise<RunnerOutcome> = Promise.resolve(settledSessionOutcome(session))
  // Every turn owns its generation, its observation and its subscription. A turn that has been
  // superseded can no longer settle, deactivate, or observe on behalf of the turn that replaced it.
  let generation = 0
  let unsubscribeActiveTurn: (() => void) | undefined

  // Start a fresh tracked turn and mark it active until it settles. waitForIdle() always returns the
  // CURRENT turn, so a revive follow-up re-arms it to the new turn instead of a stale resolved one.
  const beginTurn = (text: string): void => {
    aborted = false
    turnActive = true
    generation += 1
    const turn = generation
    const observation: TurnObservation = {
      text: undefined,
      stopReason: undefined,
      errorMessage: undefined,
      baseline: session.getLastAssistantText(),
    }
    const cell = Promise.withResolvers<RunnerOutcome>()
    running = cell.promise

    // runTurn's resolution races the session's terminating agent_end event; first writer wins.
    // Without the event path a child whose loop exits while its prompt() promise never settles
    // (#5167) strands waitForIdle forever, leaving the parent's task() blocked with no timeout.
    const settle = (outcome: RunnerOutcome): void => {
      if (turn !== generation) return
      unsubscribeActiveTurn?.()
      unsubscribeActiveTurn = undefined
      turnActive = false
      cell.resolve(outcome)
    }

    // Dropping the previous turn's subscription is what gives event attribution: a late event from
    // the prior turn reaches an unsubscribed listener instead of mutating this turn's observation.
    unsubscribeActiveTurn?.()
    unsubscribeActiveTurn = session.subscribe((event) => {
      if (turn !== generation) return
      observeTurnEvent(observation, event)
      if (event.type !== "agent_end" || !isTerminalAgentEnd(event)) return
      settle(aborted ? { status: "cancelled" } : turnOutcome(session, observation))
    })

    void runTurn(session, text, () => aborted, observation).then(settle)
  }

  const handle: ChildHandle = {
    task_id: taskId,
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
      unsubscribeActiveTurn?.()
      unsubscribeActiveTurn = undefined
      session.dispose()
    },
  }
  return { handle, beginTurn }
}

export function createChildHandle(input: CreateChildHandleInput): ChildHandle {
  const tracked = createTrackedChildHandle(input.taskId, input.session)
  tracked.beginTurn(input.promptText)
  return tracked.handle
}

// A restored child is rebuilt from its persisted transcript: the original prompt is NEVER
// replayed. The handle restores IDLE - its first followUp() starts a fresh tracked turn exactly
// like a resident revival (any continuation nudge is manager-owned, todo 12, never the runner's).
export function createRestoredChildHandle(input: CreateRestoredChildHandleInput): ChildHandle {
  return createTrackedChildHandle(input.taskId, input.session).handle
}
