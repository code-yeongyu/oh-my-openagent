import type { HostSessionIdentity, TaskRecord } from "../../state"
import type { TaskRecordStore } from "../../store"
import { createSteeringEngine } from "../../steering/engine"
import type { SteeringPort } from "../../steering/types"
import { createTaskLifecycle } from "../create"
import type { HostGenerationView } from "../host-session"
import type { LifecycleDeps } from "../port"
import type { TaskLifecycle } from "../types"
import { hostLifecycleDeps, hostSession, hostSessionRecordInput, type HostLifecycleFixture, type HostLifecycleInput } from "./host-session-fakes"
import { seedRecord, tempStore } from "./lifecycle-fakes"

export type RecordedEvent = { readonly taskId: string; readonly type: string; readonly payload: unknown }

class FakeGenerationView implements HostGenerationView {
  present = true
  parked = false
  presentCalls = 0
  failNext: Error | undefined

  generationPresent(_hostSession: HostSessionIdentity): Promise<boolean> {
    this.presentCalls += 1
    const failure = this.failNext
    this.failNext = undefined
    return failure === undefined ? Promise.resolve(this.present) : Promise.reject(failure)
  }

  parkedEntryPresent(_hostSession: HostSessionIdentity): Promise<boolean> {
    return Promise.resolve(this.parked)
  }
}

export type CancelHarness = {
  readonly store: TaskRecordStore
  readonly fixture: HostLifecycleFixture
  readonly view: FakeGenerationView
  readonly lifecycle: TaskLifecycle
  readonly engine: ReturnType<typeof createSteeringEngine>
  readonly record: TaskRecord
  readonly events: RecordedEvent[]
  readonly stopRequests: string[]
  readonly stopSettlements: string[]
  /** Resolves on the first event of `type` recorded after this call. */
  nextEvent(type: string): Promise<RecordedEvent>
  nextSettlement(): Promise<string>
}

export type CancelHarnessInput = Omit<HostLifecycleInput, "store" | "hostPid"> & {
  readonly taskId: string
  readonly deps?: Partial<LifecycleDeps>
  readonly withCancelPort?: boolean
}

export function cancelHarness(input: CancelHarnessInput): CancelHarness {
  const base = tempStore()
  const events: RecordedEvent[] = []
  const eventWaiters: Array<{ readonly type: string; readonly resolve: (event: RecordedEvent) => void }> = []
  const store: TaskRecordStore = {
    ...base,
    appendEvent: (taskId, event) => {
      const recorded = { taskId, type: event.type, payload: event.payload }
      events.push(recorded)
      for (const waiter of eventWaiters.filter((candidate) => candidate.type === event.type)) {
        eventWaiters.splice(eventWaiters.indexOf(waiter), 1)
        waiter.resolve(recorded)
      }
      return base.appendEvent(taskId, event)
    },
  }
  const fixture = hostLifecycleDeps({ ...input, store, hostPid: 4_242 })
  const view = new FakeGenerationView()
  const identity = hostSession(input.taskId, { instance_id: "instance-old" })
  const record = seedRecord(store, { ...hostSessionRecordInput(input.taskId, identity), status: "running", residency_state: "rpc_detached" })
  const lifecycle = createTaskLifecycle({ ...fixture.deps, hostGenerationView: view, ...input.deps })
  const stopRequests: string[] = []
  const stopSettlements: string[] = []
  const settleWaiters: Array<(taskId: string) => void> = []
  const port: SteeringPort = {
    store,
    liveHandle: () => undefined,
    dequeuePending: () => false,
    reserveForRevive: () => ({ ok: true, commit: () => undefined, release: () => undefined }),
    destruction: {
      destroyResidentTask: (taskId, cause) => lifecycle.destroyResidentTask(taskId, cause),
      ...(input.withCancelPort === false || lifecycle.hostSessionCancel === undefined ? {} : { hostSessionCancel: lifecycle.hostSessionCancel }),
    },
    runStatsSnapshot: () => undefined,
    stopRequested: (taskId) => stopRequests.push(taskId),
    stopSettled: (taskId) => {
      stopSettlements.push(taskId)
      for (const resolve of settleWaiters.splice(0)) resolve(taskId)
    },
    now: () => Date.parse("2026-10-29T00:00:00.000Z"),
  }
  return {
    store, fixture, view, lifecycle, record, events, stopRequests, stopSettlements,
    engine: createSteeringEngine(port),
    nextEvent: (type) => new Promise((resolve) => eventWaiters.push({ type, resolve })),
    nextSettlement: () => new Promise((resolve) => settleWaiters.push(resolve)),
  }
}

export function within<T>(promise: Promise<T>, what: string, ms = 5_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`waited ${ms}ms for ${what}, it never came`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export function eventsOf(harness: Pick<CancelHarness, "events">, type: string): readonly RecordedEvent[] {
  return harness.events.filter((event) => event.type === type)
}
