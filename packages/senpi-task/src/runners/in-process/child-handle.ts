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
  | { readonly status: "error"; readonly failure: RunnerFailure }
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

function toFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// The initial prompt is a TRACKED async op: the promise is created and its rejection handled at
// handle construction, so steering can happen WHILE it runs and no rejection ever escapes.
async function runInitialPrompt(session: ChildSession, text: string, isAborted: () => boolean): Promise<RunnerOutcome> {
  try {
    await session.prompt(text)
  } catch (error) {
    if (isAborted()) return { status: "cancelled" }
    return {
      status: "error",
      failure: { kind: "child-prompt-failed", message: toFailureMessage(error), cause: error },
    }
  }
  if (isAborted()) return { status: "cancelled" }
  return { status: "completed", finalResponse: session.getLastAssistantText() ?? "" }
}

export function createChildHandle(input: CreateChildHandleInput): ChildHandle {
  const { session } = input
  let aborted = false
  let disposed = false
  const running = runInitialPrompt(session, input.promptText, () => aborted)

  return {
    task_id: input.taskId,
    sessionId: session.sessionId,
    steer: (text) => session.steer(text),
    followUp: (text) => session.followUp(text),
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
