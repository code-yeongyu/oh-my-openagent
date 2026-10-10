import { appendFileSync, readFileSync, writeFileSync } from "node:fs"

import type { AdmitExternalMessageInput, ExternalAdmissionKind, RuntimePhase, SessionAdmissionGate, SessionRuntimePort } from "../adapter"
import { SESSION_CONTROL_DELIVERY_TYPE, SESSION_RELEASED_ENTRY_TYPE } from "../constants"

type Lane = "start" | "steer" | "followUp"

/**
 * An in-memory senpi runtime implementing the provisional `pi.session` admission contract
 * (senpi `core/external-admission.ts`): `pending` covers a started turn and both queues until the
 * delivery's transcript entry is written, a second admission of a held or written id is
 * `already_admitted`, and each written delivery is a `custom_message` line carrying its
 * `delivery_id` in the session JSONL on disk - the token the dead-claimant rule reads.
 * The faux model advances only when a test calls `toolBoundary()` / `endTurn()`.
 */
export class FakeSessionRuntime implements SessionRuntimePort {
  phaseValue: RuntimePhase = "idle"
  epoch = 0
  editorHold: "draft" | undefined = undefined
  editorRevision = 0
  closedReason: string | undefined
  readonly enqueueCalls: { readonly lane: Lane; readonly delivery_id: string }[] = []
  private readonly pending = new Map<string, Lane>()
  private readonly emitted = new Set<string>()
  private readonly steering: string[] = []
  private readonly followUps: string[] = []
  private readonly texts = new Map<string, string>()
  private readonly inputs = new Map<string, AdmitExternalMessageInput>()
  private readonly emittedListeners = new Set<(deliveryId: string) => void>()
  private readonly idleListeners = new Set<() => void>()
  readonly sessionPath: string

  constructor(sessionPath: string, durableId: string, cwd: string, options: { readonly reopen?: boolean } = {}) {
    this.sessionPath = sessionPath
    if (options.reopen === true) return
    writeFileSync(sessionPath, `${JSON.stringify({ type: "session", id: durableId, timestamp: new Date(0).toISOString(), cwd })}\n`)
  }

  phase = (): RuntimePhase => this.phaseValue

  admissionGate = (): SessionAdmissionGate => ({
    can_admit: this.editorHold === undefined,
    ...(this.editorHold === undefined ? {} : { hold_reason: this.editorHold }),
    editor_revision: this.editorRevision,
    turn_epoch: this.epoch,
  })

  admitExternalMessage = (input: AdmitExternalMessageInput): { readonly kind: ExternalAdmissionKind; readonly turn_epoch: number } => {
    if (this.closedReason !== undefined) throw new Error(this.closedReason)
    const turnEpoch = this.epoch
    const id = input.delivery_id
    if (this.pending.has(id) || this.emitted.has(id)) return { kind: "already_admitted", turn_epoch: turnEpoch }
    if (this.editorHold !== undefined) return { kind: "held_draft", turn_epoch: turnEpoch }
    if (input.expected_turn_id !== undefined && input.expected_turn_id !== turnEpoch) return { kind: "turn_conflict", turn_epoch: turnEpoch }
    this.texts.set(id, input.text)
    this.inputs.set(id, input)
    if (!this.isBusy()) {
      this.pending.set(id, "start")
      this.enqueueCalls.push({ lane: "start", delivery_id: id })
      this.beginTurn()
      queueMicrotask(() => this.persist(id))
      return { kind: "started", turn_epoch: turnEpoch }
    }
    if (input.deliverAs === "steer") {
      if (input.expected_turn_id === undefined) return { kind: "turn_conflict", turn_epoch: turnEpoch }
      this.pending.set(id, "steer")
      this.steering.push(id)
      this.enqueueCalls.push({ lane: "steer", delivery_id: id })
      return { kind: "steered", turn_epoch: turnEpoch }
    }
    this.pending.set(id, "followUp")
    this.followUps.push(id)
    this.enqueueCalls.push({ lane: "followUp", delivery_id: id })
    return { kind: "queued", turn_epoch: turnEpoch }
  }

  listAdmittedDeliveries = (): { readonly pending: readonly string[]; readonly emitted: readonly string[] } => ({
    pending: [...this.pending.keys()],
    emitted: [...this.emitted],
  })

  onEmitted(listener: (deliveryId: string) => void): () => void {
    this.emittedListeners.add(listener)
    return () => this.emittedListeners.delete(listener)
  }

  onIdle(listener: () => void): () => void {
    this.idleListeners.add(listener)
    return () => this.idleListeners.delete(listener)
  }

  beginUserTurn(): void {
    this.beginTurn()
  }

  typeDraft(): void {
    this.editorHold = "draft"
    this.editorRevision++
  }

  clearDraft(): void {
    this.editorHold = undefined
    this.editorRevision++
  }

  submitDraft(): void {
    this.editorHold = undefined
    this.editorRevision++
    appendFileSync(this.sessionPath, `${JSON.stringify({ type: "message", message: { role: "user", content: "draft" } })}\n`)
    if (this.phaseValue === "idle") this.beginTurn()
  }

  toolBoundary(): void {
    for (const id of this.steering.splice(0)) this.persist(id)
  }

  endTurn(): void {
    this.toolBoundary()
    const next = this.followUps.splice(0)
    if (next.length > 0) {
      this.beginTurn()
      for (const id of next) this.persist(id)
      return
    }
    this.phaseValue = "idle"
    for (const listener of this.idleListeners) listener()
  }

  transcriptEntries(deliveryId: string): number {
    return readFileSync(this.sessionPath, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type?: string; customType?: string; details?: { delivery_id?: string } })
      .filter((entry) => entry.type === "custom_message" && entry.customType === SESSION_CONTROL_DELIVERY_TYPE && entry.details?.delivery_id === deliveryId).length
  }

  enqueueCount(deliveryId: string): number {
    return this.enqueueCalls.filter((call) => call.delivery_id === deliveryId).length
  }

  textOf(deliveryId: string): string | undefined {
    return this.texts.get(deliveryId)
  }

  /** Who the drain said sent a delivery, and the message as written, as the session was handed them. */
  senderOf(deliveryId: string): Pick<AdmitExternalMessageInput, "sender" | "display_text"> | undefined {
    const input = this.inputs.get(deliveryId)
    return input === undefined ? undefined : { sender: input.sender, display_text: input.display_text }
  }

  /** senpi `release_session`: admission closes and the file records `session_released` before teardown. */
  release(releasedAt: number, hostInstance: string): void {
    this.closedReason = "session released"
    appendFileSync(this.sessionPath, `${JSON.stringify({
      type: "custom",
      customType: SESSION_RELEASED_ENTRY_TYPE,
      data: { reason: "takeover", interrupted: false, attachments: 0, host_instance: hostInstance, released_at: new Date(releasedAt).toISOString() },
    })}\n`)
  }

  dropQueues(): readonly string[] {
    const dropped = [...this.steering.splice(0), ...this.followUps.splice(0)]
    for (const id of dropped) this.pending.delete(id)
    return dropped
  }

  private isBusy(): boolean {
    if (this.phaseValue !== "idle") return true
    for (const lane of this.pending.values()) if (lane === "start") return true
    return false
  }

  private beginTurn(): void {
    this.epoch++
    this.phaseValue = "mid_turn"
  }

  private persist(id: string): void {
    if (this.emitted.has(id)) return
    const lane = this.pending.get(id) ?? "followUp"
    appendFileSync(this.sessionPath, `${JSON.stringify({
      type: "custom_message",
      customType: SESSION_CONTROL_DELIVERY_TYPE,
      content: this.texts.get(id) ?? "",
      display: true,
      details: { delivery_id: id, source: "session_control", deliverAs: lane === "steer" ? "steer" : "followUp" },
    })}\n`)
    this.pending.delete(id)
    this.emitted.add(id)
    for (const listener of this.emittedListeners) listener(id)
  }
}
