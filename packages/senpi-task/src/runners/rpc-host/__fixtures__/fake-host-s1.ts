import type { Socket } from "node:net"

import { FakeEffectLedger, type FakeEffect } from "./fake-effect-ledger"
import type { FakeSessionTable } from "./fake-host-sessions"
import { FakeStatusHub, type FakeSessionStatus, type FakeStatusChange, type FakeStatusSnapshot } from "./fake-status-hub"

/**
 * The S1 half of the fake daemon (senpi 2026.10.16-2): the effect ledger, the status stream,
 * queued-input ids and the client abort a turn's `agent_end` reports. Every piece is inert unless
 * the host advertises its capability, so a suite picks the old or the new host with
 * `startFakeHost({ capabilities })` and the default fake host stays an old host.
 */

export const S1_CAPABILITIES = ["session_status", "effect_ledger", "steer_when_idle", "unload_session"] as const

/** senpi main's outcome for an input `abort { clearQueue }` drained (docs/rpc.md `abort`). */
export const CLEARED_OUTCOME = "cleared_by_abort"

export interface FakeQueuedInput {
  readonly queuedId: string
  readonly mode: "steering" | "followUp"
  text: string
  readonly clientMessageId?: string
}

export interface FakeClientAbort {
  readonly connectionId: string
  readonly effectId?: string
}

const connectionIds = new WeakMap<Socket, string>()
let nextConnection = 1

export function connectionIdOf(socket: Socket): string {
  const known = connectionIds.get(socket)
  if (known !== undefined) return known
  const minted = `conn-${nextConnection++}`
  connectionIds.set(socket, minted)
  return minted
}

export class FakeS1 {
  readonly ledger = new FakeEffectLedger()
  readonly hub = new FakeStatusHub()
  private readonly queues = new Map<string, FakeQueuedInput[]>()
  private readonly contexts = new Map<string, Record<string, unknown>>()
  private readonly aborts = new Map<string, FakeClientAbort>()
  private readonly idleWaiters = new Map<string, Array<() => void>>()
  private nextQueued = 1

  constructor(
    readonly table: FakeSessionTable,
    private readonly identity: () => Readonly<Record<string, unknown>>,
  ) {}

  has(capability: (typeof S1_CAPABILITIES)[number]): boolean {
    const capabilities = this.identity().capabilities
    return Array.isArray(capabilities) && capabilities.includes(capability)
  }

  get active(): boolean {
    return S1_CAPABILITIES.some(capability => this.has(capability))
  }

  hostIdentity(): Readonly<Record<string, unknown>> {
    return this.identity()
  }

  snapshot(routingId: string, status?: FakeSessionStatus, reason?: string): FakeStatusSnapshot | undefined {
    const session = this.table.view().find(candidate => candidate.routingId === routingId)
    if (session === undefined) return undefined
    const queue = this.queue(routingId)
    const openContext = isRecord(session.context) ? session.context : {}
    return {
      sessionId: routingId,
      durableSessionId: `durable-${routingId}`,
      sessionPath: session.sessionPath,
      kind: typeof session.kind === "string" ? session.kind : "interactive",
      status: status ?? (this.table.isStreaming(routingId) ? "running" : "idle"),
      ...(reason === undefined ? {} : { reason }),
      attachments: session.attachments,
      pendingQueue: {
        steering: queue.filter(input => input.mode === "steering").length,
        followUp: queue.filter(input => input.mode === "followUp").length,
      },
      context: { ...openContext, ...this.contexts.get(routingId) },
      openContext,
    }
  }

  publish(routingId: string, change: FakeStatusChange, status?: FakeSessionStatus, reason?: string): void {
    const snapshot = this.snapshot(routingId, status, reason)
    if (snapshot !== undefined) this.hub.publishStatus(snapshot, change)
  }

  recordEffect(routingId: string, effect: FakeEffect, connectionId?: string): FakeEffect {
    const snapshot = this.snapshot(routingId)
    if (snapshot === undefined) return effect
    this.ledger.record(snapshot.sessionPath, effect)
    this.hub.publishEffect(snapshot, effect, connectionId)
    return effect
  }

  queue(routingId: string): FakeQueuedInput[] {
    const queue = this.queues.get(routingId) ?? []
    this.queues.set(routingId, queue)
    return queue
  }

  enqueue(routingId: string, payload: Readonly<Record<string, unknown>>): FakeQueuedInput {
    const input: FakeQueuedInput = {
      queuedId: `q_${this.nextQueued++}`,
      mode: payload.type === "follow_up" ? "followUp" : "steering",
      text: typeof payload.message === "string" ? payload.message : "",
      ...(typeof payload.clientMessageId === "string" ? { clientMessageId: payload.clientMessageId } : {}),
    }
    this.queue(routingId).push(input)
    return input
  }

  queueUpdate(routingId: string): Readonly<Record<string, unknown>> {
    const queue = this.queue(routingId)
    return {
      type: "queue_update",
      steering: queue.filter(input => input.mode === "steering").map(input => input.text),
      followUp: queue.filter(input => input.mode === "followUp").map(input => input.text),
      ordered: queue.map(input => ({ ...input })),
    }
  }

  patchContext(routingId: string, patch: Readonly<Record<string, unknown>>): void {
    const context = { ...this.contexts.get(routingId) }
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete context[key]
      else context[key] = value
    }
    this.contexts.set(routingId, context)
  }

  rememberAbort(routingId: string, abort: FakeClientAbort): void {
    this.aborts.set(routingId, abort)
  }

  waitForIdle(routingId: string, graceMs: number): Promise<boolean> {
    if (!this.table.isStreaming(routingId)) return Promise.resolve(true)
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), graceMs)
      const waiters = this.idleWaiters.get(routingId) ?? []
      waiters.push(() => {
        clearTimeout(timer)
        resolve(true)
      })
      this.idleWaiters.set(routingId, waiters)
    })
  }

  abortFieldsFor(routingId: string): Readonly<Record<string, unknown>> {
    const abort = this.aborts.get(routingId)
    if (!this.active || abort === undefined) return {}
    return { aborted: true, abortSource: "user", abortedBy: abort }
  }

  settled(routingId: string, aborted: boolean): void {
    for (const wake of this.idleWaiters.get(routingId) ?? []) wake()
    this.idleWaiters.delete(routingId)
    const abort = this.aborts.get(routingId)
    this.aborts.delete(routingId)
    if (!this.active) return
    if (abort?.effectId !== undefined) {
      this.recordEffect(routingId, { effectId: abort.effectId, kind: "abort", state: "done", durableSessionId: `durable-${routingId}`, disposition: "applied" }, abort.connectionId)
    }
    this.publish(routingId, { cause: "agent_idle", by: "agent" }, "idle", aborted ? "aborted" : undefined)
  }

  forget(routingId: string): void {
    this.queues.delete(routingId)
    this.contexts.delete(routingId)
    this.aborts.delete(routingId)
  }
}

const states = new WeakMap<FakeSessionTable, FakeS1>()

export function s1For(table: FakeSessionTable, identity: () => Readonly<Record<string, unknown>>): FakeS1 {
  const known = states.get(table)
  if (known !== undefined) return known
  const created = new FakeS1(table, identity)
  states.set(table, created)
  return created
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
