import type { ChildHandle as InProcessChildHandle, RunnerOutcome } from "../runners/in-process/child-handle"
import { mapExitOutcomeToError } from "../runners/rpc/exit-mapping"
import type { RpcChildHandle, RpcEntriesResult, RpcSpawnSpec, RpcSwitchSessionResult } from "../runners/types"

export type { RunnerOutcome } from "../runners/in-process/child-handle"

// The child-event seam the manager subscribes to for transcript logging. `type` is the discriminator;
// the transcript-bearing fields are OPTIONAL so both runners' concrete events (in-process
// ChildSessionEvent and rpc AgentSessionEvent) remain assignable to this widened shape.
export type ManagedChildEvent = {
  readonly type: string
  readonly message?: unknown
  readonly toolName?: string
  readonly result?: unknown
  readonly isError?: boolean
}

export type ManagedChildListener = (event: ManagedChildEvent) => void

// The ONE handle seam the TaskManager (and todos 10-12) program against. Both runners' divergent
// handle surfaces are normalized here: a promise-returning dispose, an optional pid/sessionId, and a
// single waitForOutcome() that yields the unified RunnerOutcome for either runner.
export type ManagedChildHandle = {
  readonly task_id: string
  readonly sessionId: string | undefined
  readonly pid: number | undefined
  readonly spawnSpec?: RpcSpawnSpec
  steer(text: string): Promise<void>
  followUp(text: string): Promise<void>
  abort(): Promise<void>
  subscribe(listener: ManagedChildListener): () => void
  waitForOutcome(): Promise<RunnerOutcome>
  switchSession?(sessionPath: string): Promise<RpcSwitchSessionResult>
  getEntries?(since?: string): Promise<RpcEntriesResult>
  // Partial assistant text captured so far (used by interrupt to preserve work-in-progress).
  lastAssistantText(): string | undefined
  terminate?(): Promise<void>
  dispose(): Promise<void>
}

export function adaptInProcessHandle(handle: InProcessChildHandle): ManagedChildHandle {
  return {
    task_id: handle.task_id,
    sessionId: handle.sessionId,
    pid: undefined,
    steer: (text) => handle.steer(text),
    followUp: (text) => handle.followUp(text),
    abort: () => handle.abort(),
    subscribe: (listener) => handle.subscribe(listener),
    waitForOutcome: () => handle.waitForIdle(),
    lastAssistantText: () => handle.lastAssistantText(),
    dispose: () => {
      handle.dispose()
      return Promise.resolve()
    },
  }
}

export function adaptRpcHandle(handle: RpcChildHandle): ManagedChildHandle {
  const switchSession = handle.switchSession
  const getEntries = handle.getEntries
  return {
    task_id: handle.task_id,
    get sessionId() {
      return handle.sessionId
    },
    get pid() {
      return handle.pid
    },
    ...(handle.spawnSpec === undefined ? {} : { spawnSpec: handle.spawnSpec }),
    steer: (text) => handle.steer(text),
    followUp: (text) => handle.followUp(text),
    abort: () => handle.abort(),
    subscribe: (listener) => handle.subscribe(listener),
    waitForOutcome: () => rpcOutcome(handle),
    ...(switchSession === undefined ? {} : { switchSession: (sessionPath: string) => switchSession(sessionPath) }),
    ...(getEntries === undefined ? {} : { getEntries: (since?: string) => getEntries(since) }),
    lastAssistantText: () => handle.lastAssistantText(),
    terminate: () => handle.terminate(),
    dispose: () => handle.dispose(),
  }
}

export async function discardManagedHandle(handle: ManagedChildHandle): Promise<void> {
  try {
    if (handle.terminate !== undefined) await handle.terminate()
  } finally {
    await handle.dispose()
  }
}

export async function discardRpcHandle(handle: RpcChildHandle): Promise<void> {
  try {
    await handle.terminate()
  } finally {
    await handle.dispose()
  }
}

async function rpcOutcome(handle: RpcChildHandle): Promise<RunnerOutcome> {
  await handle.waitForIdle()
  const exit = handle.exitOutcome()
  if (exit !== undefined && exit.kind !== "clean") {
    const facts = mapExitOutcomeToError(exit, { alreadyTerminal: false })
    const message = facts?.error_message ?? "RPC child terminated abnormally"
    // Thread the killed FACT (an external SIGKILL / exit-by-signal) onto the outcome so the manager can
    // persist status=error with killed:true, per the todo-8 kill contract.
    return { status: "error", failure: { kind: "child-prompt-failed", message }, killed: facts?.killed === true }
  }
  return { status: "completed", finalResponse: handle.lastAssistantText() ?? "" }
}
