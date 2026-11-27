// A scripted child runner for DAG end-to-end suites: a child settles, fails, resumes on its own, or
// loses its connection only when a test says so, and counts the stops the manager sent it.
import type { ManagedChildHandle } from "../../manager/child-handle"
import type { ManagedRunner, ManagedStartSpec } from "../../manager/types"

export type ScriptedOutcome =
  | { readonly status: "completed"; readonly finalResponse: string }
  | {
      readonly status: "error"
      readonly killed: boolean
      readonly failure: { readonly kind: "child-prompt-failed" | "child-unresponsive"; readonly message: string }
    }

export function completed(name: string): ScriptedOutcome {
  return { status: "completed", finalResponse: `output:${name}` }
}

export function failed(name: string): ScriptedOutcome {
  return {
    status: "error",
    killed: false,
    failure: { kind: "child-prompt-failed", message: `failure:${name}` },
  }
}

export function infrastructureFailed(name: string): ScriptedOutcome {
  return {
    status: "error",
    killed: false,
    failure: { kind: "child-unresponsive", message: `unresponsive:${name}` },
  }
}

export type ControlledHandle = {
  readonly handle: ManagedChildHandle
  readonly settle: (outcome: ScriptedOutcome) => void
  /** Starts a run on the child's own (a woken monitor) and resolves once the manager reopened the record. */
  readonly selfResume: () => Promise<void>
  /** How often the manager aborted and disposed this child. */
  readonly stops: { aborted: number; disposed: number }
  /** Resolves with the next stop the manager sends this child: an abort, or a dispose. */
  readonly nextStop: () => Promise<"aborted" | "disposed">
  /** Holds the next abort pending: `reached` resolves when it is sent, `release` lets it finish. */
  readonly holdStops: () => { readonly reached: Promise<void>; readonly release: () => void }
  readonly connection: ControlledConnection
}

export type ControlledConnection = {
  /** Drops the child's transport: a stop now waits until `reconnect`, as for a real RPC child. */
  readonly lose: () => void
  readonly reconnect: () => void
}

function controlledHandle(taskId: string, connectable = false): ControlledHandle {
  const stops = { aborted: 0, disposed: 0 }
  const stopWaiters: Array<(stop: "aborted" | "disposed") => void> = []
  const stopped = (stop: "aborted" | "disposed"): void => {
    for (const waiter of stopWaiters.splice(0)) waiter(stop)
  }
  const nextStop = (): Promise<"aborted" | "disposed"> => new Promise((resolve) => stopWaiters.push(resolve))
  let stopGate: { readonly reached: () => void; readonly released: Promise<void> } | undefined
  const holdStops = (): { readonly reached: Promise<void>; readonly release: () => void } => {
    let release = (): void => undefined
    let reached = (): void => undefined
    const released = new Promise<void>((resolve) => (release = resolve))
    const reachedPromise = new Promise<void>((resolve) => (reached = resolve))
    stopGate = { reached, released }
    return { reached: reachedPromise, release }
  }
  let recovering = false
  // A turn the child started on its own: an abort that completes ends it with an outcome, the way a
  // real session goes idle after its run is aborted.
  let turnRunning = false
  let reconnect = (): void => undefined
  let reconnected = new Promise<void>((resolve) => (reconnect = resolve))
  const connection: ControlledConnection = {
    lose: () => {
      recovering = true
      reconnected = new Promise<void>((resolve) => (reconnect = resolve))
    },
    reconnect: () => {
      recovering = false
      reconnect()
    },
  }
  // Outcomes are queued, not overwritten: the first waitForOutcome() takes the first settle, and a
  // revived child re-tracked under a new run epoch takes the NEXT one instead of replaying it.
  const pending: ScriptedOutcome[] = []
  const waiters: Array<(outcome: ScriptedOutcome) => void> = []
  const settle = (value: ScriptedOutcome): void => {
    turnRunning = false
    const waiter = waiters.shift()
    if (waiter === undefined) pending.push(value)
    else waiter(value)
  }
  const waitForOutcome = (): Promise<ScriptedOutcome> => {
    const ready = pending.shift()
    if (ready !== undefined) return Promise.resolve(ready)
    return new Promise<ScriptedOutcome>((resolve) => waiters.push(resolve))
  }
  const selfResumedListeners = new Set<() => void>()
  let reopened: (() => void) | undefined
  return {
    settle,
    stops,
    nextStop,
    holdStops,
    connection,
    selfResume: () =>
      new Promise<void>((resolve) => {
        turnRunning = true
        reopened = resolve
        for (const listener of [...selfResumedListeners]) listener()
      }),
    handle: {
      publishTaskStatus: (status) => {
        if (status === "running") reopened?.()
        return Promise.resolve()
      },
      onSelfResumed: (listener) => {
        selfResumedListeners.add(listener)
        return () => selfResumedListeners.delete(listener)
      },
      task_id: taskId,
      sessionId: `child-${taskId}`,
      pid: undefined,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => {
        stops.aborted += 1
        stopped("aborted")
        const gate = stopGate
        stopGate = undefined
        const endTurn = (): void => {
          if (turnRunning)
            settle({ status: "error", killed: true, failure: { kind: "child-prompt-failed", message: "aborted" } })
        }
        if (gate === undefined) {
          endTurn()
          return Promise.resolve()
        }
        gate.reached()
        return gate.released.then(endTurn)
      },
      subscribe: () => () => undefined,
      waitForOutcome,
      lastAssistantText: () => undefined,
      dispose: () => {
        stops.disposed += 1
        stopped("disposed")
        return Promise.resolve()
      },
      ...(connectable ? { transportRecovering: () => recovering, stopWhenReachable: () => reconnected } : {}),
    },
  }
}

export class ControlledRunner implements ManagedRunner {
  readonly startedSpecs: ManagedStartSpec[] = []
  readonly #handles = new Map<string, ControlledHandle>()
  readonly #startWaiters: Array<{ readonly count: number; readonly resolve: () => void }> = []
  readonly #onSettle?: () => void
  readonly #connectable: boolean

  constructor(onSettle?: () => void, options: { readonly connectable?: boolean } = {}) {
    this.#onSettle = onSettle
    this.#connectable = options.connectable === true
  }

  start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    this.startedSpecs.push(spec)
    const controlled = controlledHandle(spec.taskId, this.#connectable)
    this.#handles.set(spec.prompt.replace(/^do /, ""), controlled)
    for (const waiter of [...this.#startWaiters]) {
      if (this.startedSpecs.length >= waiter.count) waiter.resolve()
    }
    return Promise.resolve(controlled.handle)
  }

  whenStarted(count: number): Promise<void> {
    if (this.startedSpecs.length >= count) return Promise.resolve()
    return new Promise((resolve) => this.#startWaiters.push({ count, resolve }))
  }

  settle(name: string, outcome: ScriptedOutcome): void {
    const controlled = this.#handles.get(name)
    if (controlled === undefined) throw new Error(`missing controlled child ${name}`)
    this.#onSettle?.()
    controlled.settle(outcome)
  }

  selfResume(name: string): Promise<void> {
    return this.child(name).selfResume()
  }

  child(name: string): ControlledHandle {
    const controlled = this.#handles.get(name)
    if (controlled === undefined) throw new Error(`missing controlled child ${name}`)
    return controlled
  }
}

export class ImmediateRunner implements ManagedRunner {
  readonly startedSpecs: ManagedStartSpec[] = []

  start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    this.startedSpecs.push(spec)
    const output = `output:${spec.prompt.replace(/^do /, "")}`
    return Promise.resolve({
      task_id: spec.taskId,
      sessionId: `child-${spec.taskId}`,
      pid: undefined,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => Promise.resolve(),
      subscribe: () => () => undefined,
      waitForOutcome: () => Promise.resolve({ status: "completed", finalResponse: output }),
      lastAssistantText: () => output,
      dispose: () => Promise.resolve(),
    })
  }
}
