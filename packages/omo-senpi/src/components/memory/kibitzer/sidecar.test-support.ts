import type { RecallCandidate, RecallNudge } from "@oh-my-opencode/memory-core"
import type { ChildHandle, ChildSessionEvent, ChildSessionListener, RunnerOutcome } from "@oh-my-opencode/senpi-task"

import {
  createKibitzerSidecar,
  type KibitzerOfferResult,
  type KibitzerSidecar,
  type KibitzerSidecarChildInput,
  type KibitzerSidecarOptions,
  type KibitzerSidecarTimers,
} from "./sidecar"
import type { KibitzerWakeOutcome } from "./sidecar-outcome"
import { createKibitzerSidecarNudgeTool } from "./tools/nudge"
import type { KibitzerToolResult } from "./tools/result"
import type { KibitzerWakeAdmission, KibitzerWakeLease, KibitzerWakeSlot } from "./wake-slot"

export const SESSION_ID = "parent-session-1"

export function candidate(path: string, score = 1): RecallCandidate {
  return { path, description: `about ${path}`, excerpt: `excerpt of ${path}`, score }
}

/** A user message on the parent branch; the branch length is the event cursor. */
export function branchOf(length: number): unknown[] {
  return Array.from({ length }, (_, index) => ({ type: "message", id: `entry-${index}`, message: { role: "user", content: [{ type: "text", text: `turn ${index}` }] } }))
}

/** Rejects after `ms` so a test that waits for a signal that never comes fails with a name, not a hang. */
export function withinMs<T>(promise: Promise<T>, label: string, ms = 2_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms waiting for ${label}`)), ms)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

export interface ManualTimer {
  readonly id: number
  readonly ms: number
}

export interface ManualTimers extends KibitzerSidecarTimers {
  pending(): readonly ManualTimer[]
  /** Fires one scheduled callback (the earliest by default) exactly as the runtime would. */
  fire(id?: number): void
}

export function manualTimers(): ManualTimers {
  const scheduled = new Map<number, { readonly ms: number; readonly callback: () => void }>()
  let next = 1
  return {
    set(callback, ms) {
      const id = next
      next += 1
      scheduled.set(id, { ms, callback })
      return id
    },
    clear(handle) {
      if (typeof handle === "number") scheduled.delete(handle)
    },
    pending: () => [...scheduled.entries()].map(([id, entry]) => ({ id, ms: entry.ms })),
    fire(id) {
      const target = id ?? [...scheduled.keys()].sort((left, right) => left - right)[0]
      if (target === undefined) throw new Error("no timer is pending")
      const entry = scheduled.get(target)
      if (entry === undefined) throw new Error(`no timer ${target} is pending`)
      scheduled.delete(target)
      entry.callback()
    },
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/**
 * A controllable resident child that mirrors senpi-task's ChildHandle contract: the first turn is
 * running when the handle is returned, followUp on an idle child starts a fresh tracked turn,
 * followUp during a turn queues, steer records, abort settles the running turn as cancelled, and
 * every subscriber sees the events the test emits.
 */
export interface FakeChild {
  readonly handle: ChildHandle
  readonly input: KibitzerSidecarChildInput
  readonly steers: readonly string[]
  readonly followUps: readonly string[]
  readonly queuedFollowUps: readonly string[]
  readonly turns: number
  readonly aborts: number
  readonly disposed: boolean
  readonly turnActive: boolean
  emit(event: ChildSessionEvent): void
  /** Settles the running turn the way the engine would once prompt() returns. */
  settle(outcome: RunnerOutcome): void
  /** Emits the engine's record of a steered user message reaching the transcript. */
  consume(text: string): void
  /** Runs one of this child's own tools with the engine's tool events around it. */
  tool(name: string, params: Record<string, unknown>): Promise<KibitzerToolResult>
  nudge(path: string, hint: string): Promise<KibitzerToolResult>
}

export function fakeChild(input: KibitzerSidecarChildInput, sessionId = `kibitzer-child-${input.generation}`): FakeChild {
  const steers: string[] = []
  const followUps: string[] = []
  const queuedFollowUps: string[] = []
  const listeners = new Set<ChildSessionListener>()
  const counters = { turns: 1, aborts: 0, calls: 0 }
  let disposed = false
  let turnActive = true
  let running = deferred<RunnerOutcome>()

  function settle(outcome: RunnerOutcome): void {
    if (!turnActive) throw new Error("no turn is running")
    turnActive = false
    running.resolve(outcome)
  }

  function emit(event: ChildSessionEvent): void {
    for (const listener of listeners) listener(event)
  }

  const handle: ChildHandle = {
    task_id: `kibitzer-${input.sessionId}`,
    sessionId,
    async steer(text) {
      steers.push(text)
    },
    async followUp(text) {
      if (turnActive) {
        queuedFollowUps.push(text)
        return
      }
      followUps.push(text)
      counters.turns += 1
      turnActive = true
      running = deferred<RunnerOutcome>()
    },
    async abort() {
      counters.aborts += 1
      if (turnActive) settle({ status: "cancelled" })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    waitForIdle: () => running.promise,
    lastAssistantText: () => undefined,
    dispose() {
      disposed = true
    },
  }

  async function tool(name: string, params: Record<string, unknown>): Promise<KibitzerToolResult> {
    const definition = input.tools.find((entry) => entry.name === name)
    if (definition === undefined) throw new Error(`the child has no tool named ${name}`)
    counters.calls += 1
    const toolCallId = `call-${counters.calls}`
    emit({ type: "tool_execution_start", ...({ toolCallId, toolName: name, args: params } as Record<string, unknown>) })
    const result = await definition.execute(toolCallId, params as never)
    emit({ type: "tool_execution_end", ...({ toolCallId, toolName: name, isError: result.isError === true } as Record<string, unknown>) })
    return result
  }

  return {
    handle,
    input,
    steers,
    followUps,
    queuedFollowUps,
    get turns() {
      return counters.turns
    },
    get aborts() {
      return counters.aborts
    },
    get disposed() {
      return disposed
    },
    get turnActive() {
      return turnActive
    },
    emit,
    settle,
    consume(text) {
      emit({ type: "message_end", message: { role: "user", content: [{ type: "text", text }] } })
    },
    tool,
    nudge: (path, hint) => tool("nudge", { path, hint }),
  }
}

/**
 * An in-memory stand-in for the machine-wide wake lease. It grants immediately by default, turns
 * every wake away while `busy`, and while `parked` holds each acquisition until the test admits it
 * or the sidecar's signal aborts it. Every acquisition and release is counted so a test can prove
 * the lease is handed back on each exit path and that a busy slot is never polled in the background.
 */
export interface FakeWakeSlot extends KibitzerWakeSlot {
  busy: boolean
  parked: boolean
  readonly attempts: number
  readonly acquisitions: number
  readonly releases: number
  /** Leases acquired and not yet released. */
  held(): number
  /** Grants every parked acquisition. */
  admit(): void
}

export function fakeWakeSlot(maxConcurrent = 2): FakeWakeSlot {
  const counters = { attempts: 0, acquisitions: 0, releases: 0, held: 0 }
  const parkedWaiters: Array<() => void> = []

  function lease(): KibitzerWakeLease {
    counters.acquisitions += 1
    counters.held += 1
    let released = false
    return {
      slot: ((counters.acquisitions - 1) % maxConcurrent) + 1,
      async release() {
        if (released) return false
        released = true
        counters.releases += 1
        counters.held -= 1
        return true
      },
    }
  }

  const slot: FakeWakeSlot = {
    maxConcurrent,
    busy: false,
    parked: false,
    get attempts() {
      return counters.attempts
    },
    get acquisitions() {
      return counters.acquisitions
    },
    get releases() {
      return counters.releases
    },
    held: () => counters.held,
    admit() {
      for (const waiter of parkedWaiters.splice(0)) waiter()
    },
    async acquire(signal): Promise<KibitzerWakeAdmission> {
      counters.attempts += 1
      if (signal?.aborted) return { status: "aborted" }
      if (slot.busy) return { status: "busy", waitedMs: 0 }
      if (slot.parked) {
        const admitted = await new Promise<boolean>((resolve) => {
          const onAbort = (): void => resolve(false)
          signal?.addEventListener("abort", onAbort, { once: true })
          parkedWaiters.push(() => {
            signal?.removeEventListener("abort", onAbort)
            resolve(true)
          })
        })
        if (!admitted) return { status: "aborted" }
      }
      return { status: "acquired", lease: lease(), waitedMs: 0 }
    },
  }
  return slot
}

export interface SidecarHarness {
  readonly sidecar: KibitzerSidecar
  readonly slot: FakeWakeSlot
  readonly children: readonly FakeChild[]
  readonly delivered: readonly (readonly RecallNudge[])[]
  readonly outcomes: readonly KibitzerWakeOutcome[]
  readonly surfaced: Set<string>
  readonly timers: ManualTimers
  readonly clock: { now: number }
  /** Offers a candidate batch with the harness's live surfaced ledger. */
  offer(candidates: readonly RecallCandidate[], maxItems?: number): Promise<KibitzerOfferResult>
  /** Resolves with the next settled wake outcome (an explicit signal, never a sleep). */
  nextWake(): Promise<KibitzerWakeOutcome>
  /** Resolves once the next child has been started. */
  nextChild(): Promise<FakeChild>
  /** Records a parent tool_call event at the given branch cursor. */
  toolCall(cursor: number, tool?: string, input?: Record<string, unknown>): void
  /** Records a parent prompt event at the given branch cursor. */
  prompt(cursor: number, text: string): void
}

export function sidecarHarness(overrides: Partial<KibitzerSidecarOptions> = {}): SidecarHarness {
  const slot = overrides.wakeSlot === undefined ? fakeWakeSlot() : asFakeWakeSlot(overrides.wakeSlot)
  const children: FakeChild[] = []
  const delivered: RecallNudge[][] = []
  const outcomes: KibitzerWakeOutcome[] = []
  const surfaced = new Set<string>()
  const timers = manualTimers()
  const clock = { now: 1_000_000 }
  const wakeWaiters: Array<(outcome: KibitzerWakeOutcome) => void> = []
  const childWaiters: Array<(child: FakeChild) => void> = []
  const sidecar = createKibitzerSidecar({
    sessionId: SESSION_ID,
    startChild: async (input) => {
      const child = fakeChild(input)
      children.push(child)
      for (const waiter of childWaiters.splice(0)) waiter(child)
      return child.handle
    },
    createTools: (binding) => ({
      tools: [createKibitzerSidecarNudgeTool({ ...binding.nudge, searched: new Set(), budget: binding.budget })],
      searchedPaths: new Set(),
    }),
    deliver: async (nudges) => {
      delivered.push([...nudges])
      for (const nudge of nudges) surfaced.add(nudge.path)
    },
    onWake: (outcome) => {
      outcomes.push(outcome)
      for (const waiter of wakeWaiters.splice(0)) waiter(outcome)
    },
    wakeSlot: slot,
    timers,
    now: () => clock.now,
    random: () => 0.5,
    ...overrides,
  })
  return {
    sidecar,
    slot,
    children,
    delivered,
    outcomes,
    surfaced,
    timers,
    clock,
    offer: (candidates, maxItems = 2) => sidecar.offer({ candidates, surfaced: new Set(surfaced), maxItems }),
    nextWake: () => withinMs(new Promise<KibitzerWakeOutcome>((resolve) => wakeWaiters.push(resolve)), "the next wake outcome"),
    nextChild: () => withinMs(new Promise<FakeChild>((resolve) => childWaiters.push(resolve)), "the next child"),
    toolCall(cursor, tool = "read", input = { path: `src/file-${cursor}.ts` }) {
      sidecar.events.onToolCall({ toolName: tool, toolCallId: `parent-call-${cursor}`, input }, branchOf(cursor))
    },
    prompt(cursor, text) {
      sidecar.events.onPrompt({ type: "before_agent_start", prompt: text }, branchOf(cursor))
    },
  }
}

function asFakeWakeSlot(slot: KibitzerWakeSlot): FakeWakeSlot {
  if (!("held" in slot && "admit" in slot)) throw new Error("sidecarHarness only accepts a fakeWakeSlot() as wakeSlot")
  return slot as FakeWakeSlot
}
