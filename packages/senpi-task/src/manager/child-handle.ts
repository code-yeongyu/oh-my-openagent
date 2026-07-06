import type { ChildHandle as InProcessChildHandle, RunnerOutcome } from "../runners/in-process/child-handle"
import { mapExitOutcomeToError } from "../runners/rpc/exit-mapping"
import type { RpcChildHandle } from "../runners/types"

export type { RunnerOutcome } from "../runners/in-process/child-handle"

export type ManagedChildEvent = {
  readonly type: string
}

export type ManagedChildListener = (event: ManagedChildEvent) => void

// The ONE handle seam the TaskManager (and todos 10-12) program against. Both runners' divergent
// handle surfaces are normalized here: a promise-returning dispose, an optional pid/sessionId, and a
// single waitForOutcome() that yields the unified RunnerOutcome for either runner.
export type ManagedChildHandle = {
  readonly task_id: string
  readonly sessionId: string | undefined
  readonly pid: number | undefined
  steer(text: string): Promise<void>
  followUp(text: string): Promise<void>
  abort(): Promise<void>
  subscribe(listener: ManagedChildListener): () => void
  waitForOutcome(): Promise<RunnerOutcome>
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
    dispose: () => {
      handle.dispose()
      return Promise.resolve()
    },
  }
}

export function adaptRpcHandle(handle: RpcChildHandle): ManagedChildHandle {
  return {
    task_id: handle.task_id,
    get sessionId() {
      return handle.sessionId
    },
    get pid() {
      return handle.pid
    },
    steer: (text) => handle.steer(text),
    followUp: (text) => handle.followUp(text),
    abort: () => handle.abort(),
    subscribe: (listener) => handle.subscribe(listener),
    waitForOutcome: () => rpcOutcome(handle),
    dispose: () => handle.dispose(),
  }
}

async function rpcOutcome(handle: RpcChildHandle): Promise<RunnerOutcome> {
  await handle.waitForIdle()
  const exit = handle.exitOutcome()
  if (exit !== undefined && exit.kind !== "clean") {
    const facts = mapExitOutcomeToError(exit, { alreadyTerminal: false })
    const message = facts?.error_message ?? "RPC child terminated abnormally"
    return { status: "error", failure: { kind: "child-prompt-failed", message } }
  }
  return { status: "completed", finalResponse: handle.lastAssistantText() ?? "" }
}
