import type { Socket } from "node:net"

import { effectAnswer } from "./fake-effect-ledger"
import { CLEARED_OUTCOME, connectionIdOf, type FakeS1, type S1_CAPABILITIES } from "./fake-host-s1"

/**
 * The S1 commands of the fake daemon, answered in senpi's response envelope. A command whose
 * capability the host does not advertise gets the old engine's `Unknown command: <type>` refusal,
 * so a consumer's old-host path is exercised against exactly what an old host says.
 */

type Payload = Readonly<Record<string, unknown>>

const GATES: Readonly<Record<string, (typeof S1_CAPABILITIES)[number]>> = {
  subscribe_sessions: "session_status",
  unsubscribe_sessions: "session_status",
  set_session_context: "session_status",
  get_effect_status: "effect_ledger",
  dequeue_message: "effect_ledger",
  edit_queued_message: "effect_ledger",
  unload_session: "unload_session",
}

const CONTEXT_KEY = /^[a-z][a-z0-9_]{0,63}$/
const HOST_CONTEXT_KEYS = new Set(["host_socket", "host_instance", "shard_key", "tree_key", "parent_session_id", "root_session_id"])

/** Answer one S1 command; `false` leaves the line to the classic wire (an old command or an old host). */
export function handleS1Command(s1: FakeS1, socket: Socket, payload: Payload, type: string, routingId: string | undefined): boolean {
  const gate = GATES[type]
  if (gate !== undefined && !s1.has(gate)) {
    reply(socket, payload, type, { success: false, error: `Unknown command: ${type}` })
    return true
  }
  const ok = (data: unknown): void => reply(socket, payload, type, { success: true, data })
  const refuse = (errorCode: string, reason: string, action: string): void =>
    reply(socket, payload, type, { success: false, error: `${errorCode}: ${reason}`, errorCode, errorData: { reason, action } })
  switch (type) {
    case "subscribe_sessions": {
      const snapshot = s1.table.view().filter(session => !session.parked)
        .flatMap(session => s1.snapshot(session.routingId) ?? [])
      const answer = s1.hub.subscribe(socket, payload, snapshot, s1.hostIdentity())
      if ("refusal" in answer) refuse(answer.refusal.code, answer.refusal.reason, answer.refusal.action)
      else ok(answer.data)
      return true
    }
    case "unsubscribe_sessions": {
      const refusal = s1.hub.unsubscribe(socket, payload.subscriptionId)
      if (refusal === undefined) ok({})
      else refuse(refusal.code, refusal.reason, refusal.action)
      return true
    }
    case "set_session_context":
      return setContext(s1, socket, payload, routingId ?? "", ok, refuse)
    case "get_effect_status": {
      const sessionPath = typeof payload.sessionPath === "string" && routingId === undefined
        ? payload.sessionPath
        : s1.snapshot(routingId ?? "")?.sessionPath
      const effect = sessionPath === undefined || typeof payload.effectId !== "string" ? undefined : s1.ledger.find(sessionPath, payload.effectId)
      ok(effect === undefined ? { found: false, searched: "complete" } : { found: true, effect })
      return true
    }
    case "dequeue_message":
    case "edit_queued_message":
      return editQueue(s1, socket, payload, type, routingId ?? "", ok)
    case "unload_session":
      return unload(s1, socket, payload, routingId ?? "", ok)
    case "abort":
      return s1.has("effect_ledger") ? abort(s1, socket, payload, routingId ?? "", ok, refuse) : false
    case "steer":
    case "follow_up":
      if (!s1.active || typeof payload.clientMessageId === "string") return false
      ok({ disposition: admitInput(s1, payload, routingId ?? "") })
      return true
    default:
      return false
  }
}

/** Queue or start a steer / follow_up exactly as an S1 host does; `undefined` on an old host. */
export function admitInput(s1: FakeS1, payload: Payload, routingId: string): string | undefined {
  if (!s1.active || (payload.type !== "steer" && payload.type !== "follow_up")) return undefined
  if (payload.whenIdle === "start" && s1.has("steer_when_idle") && !s1.table.isStreaming(routingId)) {
    s1.table.setStreaming(routingId, true)
    s1.publish(routingId, { cause: "prompt", by: "client" })
    return "started"
  }
  s1.enqueue(routingId, payload)
  for (const attached of s1.table.attachmentsOf(routingId)) write(attached, { sessionId: routingId, ...s1.queueUpdate(routingId) })
  s1.publish(routingId, { cause: "queue", by: "client" })
  return "queued"
}

function abort(s1: FakeS1, socket: Socket, payload: Payload, routingId: string, ok: (data: unknown) => void, refuse: (code: string, reason: string, action: string) => void): boolean {
  const graceMs = payload.graceMs === undefined ? 10_000 : payload.graceMs
  if (typeof graceMs !== "number" || !Number.isInteger(graceMs) || graceMs < 0 || graceMs > 60_000) {
    refuse("invalid_argument", "invalid_grace_ms", "pass an integer graceMs from 0 to 60000")
    return true
  }
  const connectionId = connectionIdOf(socket)
  const effectId = typeof payload.effectId === "string" ? payload.effectId : undefined
  const active = s1.table.isStreaming(routingId)
  const cleared = payload.clearQueue === true ? clearQueue(s1, routingId) : undefined
  const receipt = effectId === undefined ? undefined : s1.recordEffect(routingId, {
    effectId, kind: "abort", state: active ? "applied" : "done", durableSessionId: `durable-${routingId}`,
    disposition: active ? "applied" : "no_active_turn",
  }, connectionId)
  if (active) s1.rememberAbort(routingId, { connectionId, ...(effectId === undefined ? {} : { effectId }) })
  const answer = (idle: boolean | undefined): void => {
    const latest = effectId === undefined ? undefined : (s1.ledger.find(s1.snapshot(routingId)?.sessionPath ?? "", effectId) ?? receipt)
    ok({
      ...(latest === undefined ? {} : effectAnswer(latest)),
      ...(idle === undefined ? {} : { stopped: idle, idle }),
      ...(cleared === undefined ? {} : { cleared }),
    })
  }
  if (payload.awaitIdle !== true) answer(undefined)
  else void s1.waitForIdle(routingId, graceMs).then(answer)
  return true
}

function clearQueue(s1: FakeS1, routingId: string): number {
  const drained = s1.queue(routingId).splice(0)
  for (const input of drained) {
    if (input.clientMessageId === undefined) continue
    s1.recordEffect(routingId, {
      effectId: input.clientMessageId, kind: "input", state: "failed", durableSessionId: `durable-${routingId}`,
      outcome: { kind: CLEARED_OUTCOME, reason: "the queue was cleared before this input ran", detail: input.queuedId, action: "send it again if it is still wanted" },
    })
  }
  for (const attached of s1.table.attachmentsOf(routingId)) write(attached, { sessionId: routingId, ...s1.queueUpdate(routingId) })
  s1.publish(routingId, { cause: "queue", by: "client" })
  return drained.length
}

function editQueue(s1: FakeS1, socket: Socket, payload: Payload, type: string, routingId: string, ok: (data: unknown) => void): boolean {
  const queue = s1.queue(routingId)
  const index = queue.findIndex(input => input.queuedId === payload.queuedId)
  const removing = type === "dequeue_message"
  const effectId = typeof payload.effectId === "string" ? payload.effectId : undefined
  const kind = removing ? "dequeue" : "edit_queued"
  if (index === -1) {
    const failure = { status: "not_found", reason: "no queued input has that id in this session", action: "read get_state.ordered for the current ids" }
    const effect = effectId === undefined ? undefined : s1.recordEffect(routingId, { effectId, kind, state: "failed", durableSessionId: `durable-${routingId}`, outcome: { kind: "not_found" } }, connectionIdOf(socket))
    ok({ queuedId: payload.queuedId, ...failure, ...(effect === undefined ? {} : effectAnswer(effect)) })
    return true
  }
  if (removing) queue.splice(index, 1)
  else if (typeof payload.text === "string") {
    const target = queue[index]
    if (target !== undefined) target.text = payload.text
  }
  const status = removing ? "removed" : "edited"
  const effect = effectId === undefined ? undefined : s1.recordEffect(routingId, { effectId, kind, state: "done", durableSessionId: `durable-${routingId}`, disposition: status }, connectionIdOf(socket))
  for (const attached of s1.table.attachmentsOf(routingId)) write(attached, { sessionId: routingId, ...s1.queueUpdate(routingId) })
  s1.publish(routingId, { cause: "queue", by: "client" })
  ok({ queuedId: payload.queuedId, status, ...(effect === undefined ? {} : effectAnswer(effect)) })
  return true
}

function unload(s1: FakeS1, socket: Socket, payload: Payload, routingId: string, ok: (data: unknown) => void): boolean {
  const snapshot = s1.snapshot(routingId)
  const effectId = typeof payload.effectId === "string" ? payload.effectId : undefined
  const others = s1.table.attachmentsOf(routingId).filter(attached => attached !== socket).length
  const refusal = snapshot === undefined
    ? { reason: "unsupported", detail: "no such loaded session", action: "reopen it with open_session { sessionPath }" }
    : s1.table.isStreaming(routingId) && payload.interrupt !== true
      ? { reason: "turn_active", detail: "a turn is running", action: "pass interrupt: true to stop it first" }
      : others > 0 && payload.force !== true
        ? { reason: "attached", detail: `${others} other client(s) hold the session`, action: "pass force: true; they receive the park" }
        : undefined
  if (refusal !== undefined || snapshot === undefined) {
    const effect = effectId === undefined ? undefined : s1.recordEffect(routingId, { effectId, kind: "unload", state: "failed", durableSessionId: `durable-${routingId}`, outcome: { kind: "refused", ...refusal } }, connectionIdOf(socket))
    ok({ outcome: "refused", ...refusal, ...(effect === undefined ? {} : effectAnswer(effect)) })
    return true
  }
  if (payload.clearQueue === true) s1.queue(routingId).splice(0)
  s1.table.setStreaming(routingId, false)
  const effect = effectId === undefined ? undefined : s1.recordEffect(routingId, { effectId, kind: "unload", state: "done", durableSessionId: `durable-${routingId}`, disposition: "unloaded" }, connectionIdOf(socket))
  s1.publish(routingId, { cause: "park", by: "client" }, "unloaded", "unload_session")
  const parked = s1.table.park(snapshot.sessionPath)
  for (const attached of parked?.attachments ?? []) {
    write(attached, { type: "session_parked", sessionId: routingId, sessionPath: snapshot.sessionPath, reason: "unloaded" })
  }
  ok({ outcome: "unloaded", sessionPath: snapshot.sessionPath, ...(effect === undefined ? {} : effectAnswer(effect)) })
  return true
}

function setContext(s1: FakeS1, socket: Socket, payload: Payload, routingId: string, ok: (data: unknown) => void, refuse: (code: string, reason: string, action: string) => void): boolean {
  if (!s1.table.attachmentsOf(routingId).includes(socket)) {
    refuse("session_not_attached", "this connection is not attached to that session", "attach first with open_session { sessionPath }, then patch its context")
    return true
  }
  const patch = typeof payload.patch === "object" && payload.patch !== null ? { ...payload.patch } : undefined
  const invalid = patch === undefined ? "patch must be an object" : invalidPatch(patch)
  if (invalid !== undefined || patch === undefined) {
    refuse("invalid_session_context", invalid ?? "patch must be an object", "patch only your own lowercase keys with short scalar values")
    return true
  }
  s1.patchContext(routingId, patch)
  s1.publish(routingId, { cause: "context", by: "client" })
  ok({})
  return true
}

function invalidPatch(patch: Readonly<Record<string, unknown>>): string | undefined {
  for (const [key, value] of Object.entries(patch)) {
    if (!CONTEXT_KEY.test(key)) return `key ${key} does not match ${CONTEXT_KEY.source}`
    if (HOST_CONTEXT_KEYS.has(key)) return `key ${key} belongs to the host`
    const scalar = value === null || typeof value === "number" || typeof value === "boolean" || (typeof value === "string" && value.length <= 256)
    if (!scalar) return `value of ${key} must be null, a number, a boolean or a string of at most 256 characters`
  }
  return undefined
}

function reply(socket: Socket, payload: Payload, command: string, body: Readonly<Record<string, unknown>>): void {
  write(socket, { type: "response", id: payload.id, command, ...body })
}

function write(socket: Socket, record: Readonly<Record<string, unknown>>): void {
  socket.write(`${JSON.stringify(record)}\n`)
}
