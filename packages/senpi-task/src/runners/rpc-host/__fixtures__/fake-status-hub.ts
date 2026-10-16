import type { Socket } from "node:net"

import type { FakeEffect } from "./fake-effect-ledger"

/**
 * The fake daemon's status stream (senpi `session_status`): `subscribe_sessions` answers with a
 * snapshot at seq 0, and every later `session_status` / `effect_status` of a matched session rides
 * that subscription's gap-free seq. Matching follows senpi docs/rpc.md: `sessions` is "all",
 * `{ ids }` (routing id, durable id or path) or `{ childrenOf }` (the frozen open-time context's
 * `parent_session_id`, else `root_session_id`); workers and effects default on only for childrenOf.
 */

export type FakeSessionStatus = "opening" | "idle" | "running" | "waiting_input" | "compacting" | "unloaded" | "closed"

export interface FakeStatusSnapshot {
  readonly sessionId: string
  readonly durableSessionId: string
  readonly sessionPath: string
  readonly kind: string
  readonly status: FakeSessionStatus
  readonly reason?: string
  readonly attachments: number
  readonly pendingQueue: { readonly steering: number; readonly followUp: number }
  readonly context: Readonly<Record<string, unknown>>
  readonly openContext: Readonly<Record<string, unknown>>
}

export interface FakeStatusChange {
  readonly cause: string
  readonly by: "client" | "agent" | "host"
}

export interface FakeSubscriptionRefusal {
  readonly code: "invalid_subscription" | "subscription_limit" | "unknown_subscription"
  readonly reason: string
  readonly action: string
}

type Scope = { readonly all: true } | { readonly ids: ReadonlySet<string> } | { readonly childrenOf: string }

interface Subscription {
  readonly id: string
  readonly socket: Socket
  seq: number
  readonly scope: Scope
  readonly includeWorkers: boolean
  readonly includeContext: boolean
  readonly effects: boolean
}

const SUBSCRIPTIONS_PER_CONNECTION = 64

export class FakeStatusHub {
  private nextId = 1
  private readonly subscriptions = new Map<string, Subscription>()

  subscribe(
    socket: Socket,
    payload: Readonly<Record<string, unknown>>,
    snapshot: readonly FakeStatusSnapshot[],
    identity: Readonly<Record<string, unknown>>,
  ): { readonly data: Readonly<Record<string, unknown>> } | { readonly refusal: FakeSubscriptionRefusal } {
    const held = [...this.subscriptions.values()].filter(subscription => subscription.socket === socket).length
    if (held >= SUBSCRIPTIONS_PER_CONNECTION) {
      return { refusal: { code: "subscription_limit", reason: "this connection already holds 64 subscriptions", action: "unsubscribe one first" } }
    }
    const scope = parseScope(payload.sessions)
    if (scope === undefined) {
      return { refusal: { code: "invalid_subscription", reason: "sessions must be \"all\", { ids } or { childrenOf }", action: "fix the sessions selector" } }
    }
    const children = "childrenOf" in scope
    const subscription: Subscription = {
      id: `sub-${this.nextId++}`,
      socket,
      seq: 0,
      scope,
      includeWorkers: flag(payload.include_workers, children),
      includeContext: flag(payload.include_context, false),
      effects: flag(payload.effects, children),
    }
    this.subscriptions.set(subscription.id, subscription)
    const at = new Date().toISOString()
    return {
      data: {
        subscriptionId: subscription.id,
        seq: 0,
        hostGeneration: String(identity.generation),
        hostInstanceId: identity.instanceId,
        snapshot: snapshot
          .filter(session => matches(subscription, session))
          .map(session => statusRecord(subscription, session, { cause: "open", by: "host" }, at)),
      },
    }
  }

  unsubscribe(socket: Socket, subscriptionId: unknown): FakeSubscriptionRefusal | undefined {
    const subscription = typeof subscriptionId === "string" ? this.subscriptions.get(subscriptionId) : undefined
    if (subscription === undefined || subscription.socket !== socket) {
      return { code: "unknown_subscription", reason: "no such subscription on this connection", action: "subscribe again" }
    }
    this.subscriptions.delete(subscription.id)
    return undefined
  }

  drop(socket: Socket): void {
    for (const subscription of [...this.subscriptions.values()]) {
      if (subscription.socket === socket) this.subscriptions.delete(subscription.id)
    }
  }

  publishStatus(session: FakeStatusSnapshot, change: FakeStatusChange): void {
    const at = new Date().toISOString()
    for (const subscription of this.subscriptions.values()) {
      if (!matches(subscription, session)) continue
      subscription.seq += 1
      write(subscription.socket, statusRecord(subscription, session, change, at))
    }
  }

  publishEffect(session: FakeStatusSnapshot, effect: FakeEffect, connectionId: string | undefined): void {
    const at = new Date().toISOString()
    for (const subscription of this.subscriptions.values()) {
      if (!subscription.effects || !matches(subscription, session)) continue
      subscription.seq += 1
      write(subscription.socket, {
        type: "effect_status",
        subscriptionId: subscription.id,
        seq: subscription.seq,
        sessionId: session.sessionId,
        effectId: effect.effectId,
        kind: effect.kind,
        state: effect.state,
        ...(effect.disposition === undefined ? {} : { disposition: effect.disposition }),
        ...(effect.outcome === undefined ? {} : { outcome: effect.outcome }),
        ...(connectionId === undefined ? {} : { by: { connectionId } }),
        at,
      })
    }
  }
}

function parseScope(sessions: unknown): Scope | undefined {
  if (sessions === undefined || sessions === "all") return { all: true }
  if (typeof sessions !== "object" || sessions === null) return undefined
  const selector: Readonly<Record<string, unknown>> = { ...sessions }
  if (Array.isArray(selector.ids)) return { ids: new Set(selector.ids.map(String)) }
  if (typeof selector.childrenOf === "string" && selector.childrenOf !== "") return { childrenOf: selector.childrenOf }
  return undefined
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function matches(subscription: Subscription, session: FakeStatusSnapshot): boolean {
  if (session.kind === "worker" && !subscription.includeWorkers) return false
  const scope = subscription.scope
  if ("all" in scope) return true
  if ("ids" in scope) {
    return scope.ids.has(session.sessionId) || scope.ids.has(session.durableSessionId) || scope.ids.has(session.sessionPath)
  }
  const lineage = session.openContext.parent_session_id ?? session.openContext.root_session_id
  return lineage === scope.childrenOf
}

function statusRecord(
  subscription: Subscription,
  session: FakeStatusSnapshot,
  change: FakeStatusChange,
  at: string,
): Readonly<Record<string, unknown>> {
  return {
    type: "session_status",
    subscriptionId: subscription.id,
    seq: subscription.seq,
    sessionId: session.sessionId,
    durableSessionId: session.durableSessionId,
    sessionPath: session.sessionPath,
    kind: session.kind,
    status: session.status,
    ...(session.reason === undefined ? {} : { reason: session.reason }),
    attachments: session.attachments,
    pendingQueue: session.pendingQueue,
    lastChange: { at, cause: change.cause, by: change.by },
    ...(subscription.includeContext ? { context: session.context } : {}),
  }
}

function write(socket: Socket, record: Readonly<Record<string, unknown>>): void {
  socket.write(`${JSON.stringify(record)}\n`)
}
