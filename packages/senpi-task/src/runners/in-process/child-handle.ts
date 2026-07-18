export type ChildSessionEvent = {
  readonly type: string
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
  readonly kind: "child-prompt-failed" | "session-create-failed" | "depth-exceeded"
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

// A prompt turn is a TRACKED async op: the promise is created and its rejection handled at the
// call site, so steering can happen WHILE it runs and no rejection ever escapes. The same routine
// drives the initial prompt and every revive follow-up (a fresh turn on an idle resident session).
async function runTurn(session: ChildSession, text: string, isAborted: () => boolean): Promise<RunnerOutcome> {
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
  return { status: "completed", finalResponse: session.getLastAssistantText() ?? "" }
}

export function createChildHandle(input: CreateChildHandleInput): ChildHandle {
  const { session } = input
  let aborted = false
  let disposed = false
  let turnActive = false
  let running: Promise<RunnerOutcome>

  // Start a fresh tracked turn and mark it active until it settles. waitForIdle() always returns the
  // CURRENT turn, so a revive follow-up re-arms it to the new turn instead of a stale resolved one.
  const beginTurn = (text: string): void => {
    aborted = false
    turnActive = true
    running = runTurn(session, text, () => aborted)
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
      session.dispose()
    },
  }
}
