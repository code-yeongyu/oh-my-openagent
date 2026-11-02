import type { AgentSession } from "@code-yeongyu/senpi"
import { reportedEffectiveModel, type CatalogModelIdentity, type EffectiveModel } from "../pinned-model-equivalence"

import type { TaskInterruptCause } from "../../state/record-types"
import type { NativeRunPause } from "../../pause/native-child-pause"
import type { InputIdentity } from "../types"
import { createInProcessRunPause, type EngineTurnWatch, type RunHoldSession } from "./native-run-pause"
import type { TaskStartFailureKind, TaskStartFailureReason } from "../../state/start-failure"
import { createInProcessAsyncWork, type AsyncWorkSession, type InProcessAsyncWorkOptions } from "./async-work-turn"
import { observeTurnEvent, settledSessionOutcome, turnOutcome, type TurnObservation } from "./turn-observation"

/** How the engine settled a steer/follow-up: delivered to the running turn, or queued behind it. */
export type QueuedInputDisposition = Awaited<ReturnType<AgentSession["steer"]>>

// ChildHandle.steer settles with no value: the manager does not consume the engine disposition.
const ignoreQueuedInputDisposition = (_disposition: QueuedInputDisposition): void => undefined

export type ChildSessionEvent = {
  readonly type: string
  readonly message?: unknown
}

export type ChildSessionListener = (event: ChildSessionEvent) => void

/** The slice of senpi's ExtensionRunner that child teardown needs to run session_shutdown. */
export type ChildExtensionRunner = {
  hasHandlers(eventType: string): boolean
  emit(event: { readonly type: "session_shutdown"; readonly reason: "quit" }): Promise<unknown>
}

/**
 * Structural subset of senpi's AgentSession that the handle drives. The default seam returns a
 * live AgentSession; fakes implement only these members. `model` is what the session actually
 * started on, read by the runner's post-start pin check (#9722); fakes may omit it.
 */
export type ChildSession = RunHoldSession & AsyncWorkSession & {
  readonly sessionId: string
  readonly model?: CatalogModelIdentity
  readonly effectiveServiceTier?: string
  prompt(text: string, options?: InputIdentity): Promise<void>
  steer(text: string, images?: undefined, options?: InputIdentity): Promise<QueuedInputDisposition>
  followUp(text: string, images?: undefined, options?: InputIdentity): Promise<QueuedInputDisposition>
  abort(): Promise<void>
  subscribe(listener: ChildSessionListener): () => void
  getLastAssistantText(): string | undefined
  /** Absent on fakes that load no extensions; a live AgentSession always has one. */
  readonly extensionRunner?: ChildExtensionRunner
  dispose(): void
}

/**
 * A closed, PARENT-AUTHORED classification of why a runner refused. Unlike `message`, no member is
 * ever derived from child output, so it is the one part of a failure that is safe to surface and
 * persist verbatim - and `manager.ts` still treats it only as a lookup key, never as text to echo.
 */
export type RunnerFailureReason = TaskStartFailureReason

export type RunnerFailure = {
  // The snake_case kinds map 1:1 onto the manager's respawn disposition codes (todo 12): a resume
  // rebuild failure is TYPED and retryable, never a silently weakened tool set or transcript.
  readonly kind: TaskStartFailureKind
  readonly message: string
  readonly reason?: RunnerFailureReason
  readonly cause?: unknown
  // Set only with `launch_spec_insecure`: the refused spec path omo resolved itself, never child
  // output, so the public start failure may name the file and its fix (#9208).
  readonly launch_spec_path?: string
  /**
   * Structured exit facts for the internal event log, when the child actually reached a process exit.
   *
   * `message` is stderr-derived (`runners/rpc/exit-mapping.ts`) and therefore untrusted child output,
   * so it must never reach a durable artifact - `manager.ts publicStartFailureMessage` collapses it for
   * exactly that reason. These are closed enums and numbers, which cannot carry a credential, so they
   * can be persisted and finally answer WHY a child died instead of only THAT it died.
   *
   * `rejected_while` is captured by the RPC runner before unstarted-handle cleanup: `alive` means
   * the initial command rejected while the child was still live, while `exited` means the child had
   * already produced the exit outcome. It is intentionally separate from `exit`, because cleanup
   * terminates a still-live child and must never be mistaken for the rejection's cause.
   *
   * Shape is inlined rather than imported from `../types`: that module imports RunnerOutcome from this
   * one, so importing back would close a cycle.
   */
  readonly rejected_while?: "alive" | "exited"
  readonly exit?: {
    readonly kind: "clean" | "killed" | "crashed" | "spawn_error"
    readonly code: number | null
    readonly signal: NodeJS.Signals | null
  }
}

export type RunnerOutcome =
  | { readonly status: "completed"; readonly finalResponse: string; readonly model?: string }
  | { readonly status: "error"; readonly failure: RunnerFailure; readonly killed?: boolean; readonly model?: string }
  | { readonly status: "cancelled" }
  // A run stopped for a reason the parent did not request: its session was replaced (cause, message), or
  // another client's user abort took it (F10a: partial text kept, abortedBy). Resumable; never a failure.
  | {
      readonly status: "interrupted"
      readonly cause?: TaskInterruptCause
      readonly message?: string
      readonly finalResponse?: string
      readonly abortedBy?: string
    }

export type ChildCompletionPolicy = "final-text" | "turn"

export type ChildHandle = {
  readonly task_id: string
  readonly sessionId: string
  readonly runPause?: NativeRunPause
  /** The model the child session is ACTUALLY on, read live - the post-start record's source (#9722). */
  effectiveModel(): EffectiveModel | undefined
  steer(text: string, identity?: InputIdentity): Promise<void>
  followUp(text: string, identity?: InputIdentity): Promise<void>
  abort(): Promise<void>
  subscribe(listener: ChildSessionListener): () => void
  waitForIdle(): Promise<RunnerOutcome>
  lastAssistantText(): string | undefined
  dispose(): Promise<void> | void
}

export type CreateChildHandleInput = {
  readonly taskId: string
  readonly session: ChildSession
  readonly promptText: string
  readonly completion?: ChildCompletionPolicy
  readonly asyncWork?: InProcessAsyncWorkOptions
}

export type CreateRestoredChildHandleInput = {
  readonly taskId: string
  readonly session: ChildSession
  readonly completion?: ChildCompletionPolicy
  readonly asyncWork?: InProcessAsyncWorkOptions
}

// A prompt turn is a TRACKED async op: the promise is created and its rejection handled at the
// call site, so steering can happen WHILE it runs and no rejection ever escapes. The same routine
// drives the initial prompt and every revive follow-up (a fresh turn on an idle resident session).
async function runTurn(
  session: ChildSession,
  text: string,
  isAborted: () => boolean,
  observation: TurnObservation,
  completion: ChildCompletionPolicy,
  identity: InputIdentity | undefined,
): Promise<RunnerOutcome> {
  try {
    await session.prompt(text, identity)
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
  return turnOutcome(session, observation, completion)
}

type TrackedChildHandle = {
  readonly handle: ChildHandle
  beginTurn(text: string, identity?: InputIdentity): void
}

function createTrackedChildHandle(
  taskId: string,
  session: ChildSession,
  completion: ChildCompletionPolicy = "final-text",
  asyncWorkOptions?: InProcessAsyncWorkOptions,
): TrackedChildHandle {
  let aborted = false
  let disposed = false
  let turnActive = false
  // Seeded for the restored case; createChildHandle's beginTurn replaces it immediately.
  let running: Promise<RunnerOutcome> = Promise.resolve(settledSessionOutcome(session, completion))
  const observation: TurnObservation = {
    text: undefined, stopReason: undefined, errorMessage: undefined, baseline: undefined, provider: undefined, model: undefined,
  }
  const unsubscribeObserver = session.subscribe((event) => observeTurnEvent(observation, event))
  const resetObservation = (): void => {
    observation.text = undefined
    observation.stopReason = undefined
    observation.errorMessage = undefined
    observation.provider = undefined
    observation.model = undefined
    observation.baseline = session.getLastAssistantText()
  }
  // omo#10487: a completed turn whose own async work is still pending is held until that work's
  // engine turn answers (async-work-turn.ts); that engine turn is tracked like a parent turn.
  const asyncWork = createInProcessAsyncWork({
    session,
    options: asyncWorkOptions,
    engineTurnStarted: () => {
      aborted = false
      turnActive = true
      resetObservation()
    },
    engineTurnOutcome: () => {
      turnActive = false
      return aborted ? { status: "cancelled" } : turnOutcome(session, observation, completion)
    },
  })

  // Start a fresh tracked turn and mark it active until it settles. waitForIdle() always returns the
  // CURRENT turn, so a revive follow-up re-arms it to the new turn instead of a stale resolved one.
  const beginTurn = (text: string, identity?: InputIdentity): void => {
    aborted = false
    turnActive = true
    resetObservation()
    const prompted = runTurn(session, text, () => aborted, observation, completion, identity)
    void prompted.then(
      () => {
        turnActive = false
      },
      () => {
        turnActive = false
      },
    )
    const turn = prompted.then(asyncWork.settle)
    asyncWork.supersede(turn)
    running = turn
  }

  // The engine starts a resumed turn itself: observe it from its agent_start to its agent_end.
  const watchEngineTurn = (): EngineTurnWatch => {
    const settled = Promise.withResolvers<RunnerOutcome>()
    let started = false
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "agent_start" && !started) {
        started = true
        aborted = false
        turnActive = true
        resetObservation()
        running = settled.promise
      } else if (event.type === "agent_end" && started) {
        unsubscribe()
        turnActive = false
        settled.resolve(aborted ? { status: "cancelled" } : turnOutcome(session, observation, completion))
      }
    })
    return { outcome: settled.promise, cancel: unsubscribe }
  }
  const runPause = createInProcessRunPause(session, watchEngineTurn)

  const handle: ChildHandle = {
    task_id: taskId,
    sessionId: session.sessionId,
    ...(runPause === undefined ? {} : { runPause }),
    effectiveModel: () => reportedEffectiveModel(session.model, session.effectiveServiceTier),
    steer: (text, identity) => session.steer(text, undefined, identity).then(ignoreQueuedInputDisposition),
    followUp: async (text, identity) => {
      // While a turn is running, a follow-up is queued and delivered when the agent settles. Once
      // the child is idle/resident, a follow-up REVIVES it: drive a fresh turn and re-arm tracking.
      if (turnActive) {
        await session.followUp(text, undefined, identity)
        return
      }
      beginTurn(text, identity)
    },
    abort: async () => {
      aborted = true
      asyncWork.abort()
      await session.abort()
    },
    subscribe: (listener) => session.subscribe(listener),
    waitForIdle: () => running,
    lastAssistantText: () => session.getLastAssistantText(),
    dispose: async () => {
      if (disposed) return
      disposed = true
      asyncWork.abandon()
      unsubscribeObserver()
      await shutDownChildSession(session)
    },
  }
  return { handle, beginTurn }
}

export function createChildHandle(input: CreateChildHandleInput): ChildHandle {
  const staged = createStagedChildHandle(input)
  staged.begin()
  return staged.handle
}

// A created child whose first prompt has not been sent: the launch decides, after creation, whether
// to begin that turn or hold the prompt for the run's Resume.
export function createStagedChildHandle(input: CreateChildHandleInput): { readonly handle: ChildHandle; begin(): void } {
  const tracked = createTrackedChildHandle(input.taskId, input.session, input.completion, input.asyncWork)
  return { handle: tracked.handle, begin: () => tracked.beginTurn(input.promptText) }
}

// A restored child is rebuilt from its persisted transcript: the original prompt is NEVER
// replayed. The handle restores IDLE - its first followUp() starts a fresh tracked turn exactly
// like a resident revival (any continuation nudge is manager-owned, todo 12, never the runner's).
export function createRestoredChildHandle(input: CreateRestoredChildHandleInput): ChildHandle {
  return createTrackedChildHandle(input.taskId, input.session, input.completion, input.asyncWork).handle
}

// The pre-admission counterpart of rpc/start-cleanup.ts: when handle construction itself throws,
// the session that createSession() already opened belongs to nobody - no handle exists, so neither
// the manager nor the lifecycle destruction port can ever reach it. Discarding it here keeps that
// teardown inside the handle-definition module that owns dispose delegation, so the single-writer
// rule still holds: lifecycle remains the only INVOKER for admitted handles.
export async function discardUnstartedChildSession(session: ChildSession): Promise<void> {
  await shutDownChildSession(session)
}

// #9413: a bare dispose() never emits session_shutdown; only senpi's AgentSessionRuntime does. An
// in-process child loads the builtin extensions, and codemode closes its per-session bridge server
// (like every other shutdown-scoped resource) only on session_shutdown, so without this the child
// leaks a listening socket that keeps `omo -p` alive. The runner applies the host's per-handler
// shutdown budget, so a hung handler cannot hold teardown, and dispose() runs either way.
async function shutDownChildSession(session: ChildSession): Promise<void> {
  try {
    const runner = session.extensionRunner
    if (runner?.hasHandlers("session_shutdown") === true) await runner.emit({ type: "session_shutdown", reason: "quit" })
  } finally {
    session.dispose()
  }
}
