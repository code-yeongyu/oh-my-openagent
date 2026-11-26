// Shared stand-ins for the DAG runtime recovery tests: a runner whose children settle only when the
// test says so, and lease-watch timers the test ticks by hand.
import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import type { ManagedChildHandle, ManagedRunner, ManagedStartSpec, RunnerOutcome } from "@oh-my-opencode/senpi-task"
import type { DagLeaseWatchTimerHandle, DagLeaseWatchTimers } from "@oh-my-opencode/senpi-task/dag"

import { remainingTestTime } from "../../../../../test-support/test-deadline"
import type { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine, type TaskEngine } from "./engine"
import { createTeamServiceTestModelRegistry } from "./team-service-test-model-registry"

// Above every reachable pid, so it can only ever be "alive" through the injected probe.
export const FOREIGN_HOST_PID = 2_147_483_647

function deferred<T>() {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

export function dagNode(id: string, dependsOn?: readonly string[]) {
  return {
    id,
    prompt: id,
    subagent_type: "explore",
    model: "omo-mock/mock-1",
    ...(dependsOn === undefined ? {} : { dependsOn }),
  }
}

/** A task engine for `sessionId` in `cwd` whose children are the runner's to settle. */
export function recoveryEngine(
  cwd: string,
  sessionId: string,
  pi: FakeExtensionAPI,
  runner: ScriptedRunner,
): TaskEngine {
  const engine = composeTaskEngine({
    pi,
    omoConfig: loadOmoConfig({ cwd }).config,
    cwd,
    sharedParentTools: () => [],
    runnerFactories: { inProcess: () => runner, process: () => runner },
  })
  engine.runtime.captureFrom({
    modelRegistry: createTeamServiceTestModelRegistry(),
    sessionManager: { getSessionId: () => sessionId },
  })
  return engine
}

/**
 * Holds the admission of every child whose owner `gated` names until `release`: the window between a
 * scheduler taking a run and its first child attaching, made observable.
 */
export function gateStartOwned(engine: TaskEngine, gated: (owner: { readonly runId: string }) => boolean) {
  const gate = deferred<undefined>()
  const entered = deferred<undefined>()
  const calls: string[] = []
  const original = engine.manager.startOwned.bind(engine.manager)
  Object.assign(engine.manager, {
    startOwned: async (...args: Parameters<typeof original>) => {
      calls.push(`${args[1].runId}:${String(args[1].nodeId)}`)
      if (gated(args[1])) {
        entered.resolve(undefined)
        await gate.promise
      }
      return original(...args)
    },
  })
  return { calls, entered: entered.promise, release: () => gate.resolve(undefined) }
}

export function within<T>(promise: Promise<T>, step: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const bound = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`the test budget ran out while awaiting ${step}`)), remainingTestTime())
  })
  return Promise.race([promise, bound]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

export class ScriptedRunner implements ManagedRunner {
  readonly handles: Array<{ readonly spec: ManagedStartSpec; readonly settle: (output: string) => void }> = []
  readonly aborted: string[] = []
  readonly #started = new Map<number, ReturnType<typeof deferred<undefined>>>()

  start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const outcome = deferred<RunnerOutcome>()
    const handle: ManagedChildHandle = {
      task_id: spec.taskId,
      sessionId: `child-${spec.taskId}`,
      pid: undefined,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => {
        this.aborted.push(spec.taskId)
        outcome.resolve({ status: "cancelled" })
        return Promise.resolve()
      },
      subscribe: () => () => undefined,
      waitForOutcome: () => outcome.promise,
      lastAssistantText: () => undefined,
      dispose: () => Promise.resolve(),
    }
    this.handles.push({ spec, settle: (output) => outcome.resolve({ status: "completed", finalResponse: output }) })
    this.#started.get(this.handles.length)?.resolve(undefined)
    return Promise.resolve(handle)
  }

  whenStarted(count: number): Promise<void> {
    if (this.handles.length >= count) return Promise.resolve()
    const signal = this.#started.get(count) ?? deferred<undefined>()
    this.#started.set(count, signal)
    return signal.promise
  }
}

export class ManualTimers implements DagLeaseWatchTimers {
  readonly #timers = new Map<number, () => void>()
  #next = 0

  set(callback: () => void): number {
    this.#next += 1
    this.#timers.set(this.#next, callback)
    return this.#next
  }

  clear(handle: DagLeaseWatchTimerHandle): void {
    if (typeof handle === "number") this.#timers.delete(handle)
  }

  pending(): number {
    return this.#timers.size
  }

  tick(): void {
    const due = [...this.#timers.values()]
    this.#timers.clear()
    for (const callback of due) callback()
  }
}

export type WarnRecord = { readonly message: string; readonly fields: Record<string, unknown> | undefined }
