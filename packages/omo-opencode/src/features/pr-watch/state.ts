import { createHash, randomBytes } from "node:crypto"

export type PrWatchEvent = {
  key: string
  kind: "check_failed" | "checks_passed" | "comment" | "conflict" | "stopped"
  fact: string
}

export type PrWatchRegistration = {
  id: string
  reference: string
  sessionID: string
  host?: string
  directory?: string
  generation: number
  actor: string
  startedAt: number
  active: boolean
  reason?: string
  commentOnlyWakes: number
  unreadableSince?: number
  observed?: boolean
  told: string[]
}

export type PrWatchWake = {
  id: string
  watchID: string
  generation: number
  events: PrWatchEvent[]
  retryAt?: number
  messageID?: string
  status: "pending" | "delivered"
}

export type PrWatchSnapshot = {
  statusFingerprint?: string
  remarksFingerprint?: string
  lastRemarksReadAt?: number
  details?: import("./github").PrDetails
  activity?: import("./github").PrActivity
  transition: number
}

export type PrWatchState = {
  version: 1
  nextPollAt?: number
  registrations: Record<string, PrWatchRegistration>
  outbox: Record<string, PrWatchWake>
  snapshots: Record<string, PrWatchSnapshot>
}

export function emptyPrWatchState(): PrWatchState {
  return { version: 1, registrations: {}, outbox: {}, snapshots: {} }
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function normalizePrReference(reference: string): string {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#([1-9]\d*)$/.exec(reference)
  if (!match || !Number.isSafeInteger(Number(match[3]))) throw new Error("Expected owner/repo#number")
  return `${match[1].toLowerCase()}/${match[2].toLowerCase()}#${Number(match[3])}`
}

/** These mutations are persisted together by the manager's serialized transaction. */
export function registerPrWatch(state: PrWatchState, reference: string, sessionID: string, actor: string, now = Date.now()): PrWatchRegistration {
  const normalized = normalizePrReference(reference)
  if (!sessionID || !actor) throw new Error("PR watch requires a session and authenticated GitHub actor")
  const id = hash([normalized, sessionID])
  const old = state.registrations[id]
  if (old?.active) return old
  const registration: PrWatchRegistration = {
    id, reference: normalized, sessionID, actor: actor.toLowerCase(), startedAt: now,
    generation: old ? old.generation + 1 : randomBytes(6).readUIntBE(0, 6) + 1, active: true, observed: false, commentOnlyWakes: 0, told: [],
  }
  state.registrations[id] = registration
  return registration
}

export function stopPrWatch(state: PrWatchState, id: string, reason: string): void {
  const registration = state.registrations[id]
  if (!registration) return
  registration.active = false
  registration.reason = reason
  registration.generation += 1
  for (const [wakeID, wake] of Object.entries(state.outbox)) {
    if (wake.watchID === id && wake.status === "pending") delete state.outbox[wakeID]
  }
}

export function recordPrWatchEvents(
  state: PrWatchState,
  captured: Pick<PrWatchRegistration, "id" | "generation">,
  events: readonly PrWatchEvent[],
): PrWatchWake | undefined {
  const registration = state.registrations[captured.id]
  // A read started before unwatch, rewatch or session teardown cannot resurrect delivery.
  if (!registration?.active || registration.generation !== captured.generation) return
  const fresh = events.filter((event) => !registration.told.includes(event.key))
  // Only the current observation needs suppression; old changes live in the durable outbox.
  registration.told = events.map((event) => event.key)
  if (fresh.length === 0) return
  const id = hash([registration.id, registration.generation, fresh.map((event) => event.key)])
  const wake: PrWatchWake = { id, watchID: registration.id, generation: registration.generation, events: [...fresh], status: "pending" }
  // Persist both event progress and the outbox in one atomic snapshot. Progress does not mean delivered.
  state.outbox[id] = wake
  const commentOnly = fresh.every((event) => event.kind === "comment")
  registration.commentOnlyWakes = commentOnly ? registration.commentOnlyWakes + 1 : 0
  if (registration.commentOnlyWakes >= 10) {
    registration.active = false
    registration.reason = "ten_consecutive_comment_only_wakes"
    // Keep this final committed wake deliverable; future polls are stopped.
  }
  return wake
}

export function recordPrWatchReadFailure(state: PrWatchState, captured: Pick<PrWatchRegistration, "id" | "generation">, now: number, reason: string): void {
  const registration = state.registrations[captured.id]
  if (!registration?.active || registration.generation !== captured.generation) return
  registration.unreadableSince ??= now
  if (now - registration.unreadableSince < 15 * 60_000) return
  recordPrWatchEvents(state, captured, [{ key: `unreadable:${registration.unreadableSince}`, kind: "stopped", fact: `PR watch stopped after 15 minutes without readable host data: ${reason}` }])
  registration.active = false
  registration.reason = "host_unreadable_fifteen_minutes"
}

export function pendingPrWatchWakes(state: PrWatchState): PrWatchWake[] {
  return Object.values(state.outbox).filter((wake) => {
    const registration = state.registrations[wake.watchID]
    return wake.status === "pending" && registration?.generation === wake.generation
  })
}

export function acknowledgePrWatchWake(state: PrWatchState, wakeID: string): void {
  const wake = state.outbox[wakeID]
  const registration = wake && state.registrations[wake.watchID]
  if (wake && registration?.generation === wake.generation) delete state.outbox[wakeID]
}

// OpenCode message ids sort by their timestamp prefix. Persist once, before attempting delivery.
export function orderedPrWatchMessageID(latest?: string): string {
  // Match OpenCode Identifier.ascending's six-byte (millisecond << 12) prefix.
  let time = (BigInt(Date.now()) * 0x1000n) & 0xffffffffffffn
  if (latest && /^msg_[0-9a-f]{12}/.test(latest)) {
    const previous = BigInt(`0x${latest.slice(4, 16)}`)
    if (previous >= time) time = previous + 1n
  }
  return `msg_${time.toString(16).padStart(12, "0")}${randomBytes(7).toString("hex")}`
}

export function prunePrWatchState(state: PrWatchState): void {
  for (const [id, wake] of Object.entries(state.outbox)) {
    if (wake.status === "delivered" || state.registrations[wake.watchID]?.generation !== wake.generation) delete state.outbox[id]
  }
  const pending = new Set(Object.values(state.outbox).map(wake => wake.watchID))
  for (const [id, row] of Object.entries(state.registrations)) {
    if (!row.active && !pending.has(id)) delete state.registrations[id]
  }
  const references = new Set(Object.values(state.registrations).filter(row => row.active).map(row => row.reference))
  for (const reference of Object.keys(state.snapshots)) {
    if (!references.has(reference)) delete state.snapshots[reference]
  }
}
