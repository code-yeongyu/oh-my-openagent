import { log } from "@oh-my-opencode/utils"
import type { AdmissionParticipant, ResumeCredential } from "./admission-barrier"
import type { ObservedHold, RunPauseOwner, RunRef } from "./ports"
import { PauseRegistry, type PauseParticipant } from "./registry"
import { inRemoteClass, REMOTE_DEADLINE_MS, remoteFailure, retriedAsRemote, writeRemote, type RemoteResult } from "./remote-participants"
import { pauseRemote, resumeRemote } from "./remote-steps"
import { holdOrLose, observe, propagate } from "./propagate"

export type ResumeParticipantRequest = RunPauseOwner & {
  readonly resumeId: string
  readonly childSeqCutoff?: number
}

export type RunPauseEffects = {
  snapshot(parentSessionId: string, admissions: readonly AdmissionParticipant[]): readonly PauseParticipant[]
  quiesce(parentSessionId: string, pauseSeq: number): void | Promise<void>
  settleCreations?(parentSessionId: string, pauseSeq: number): Promise<void>
  addFences(parentSessionId: string, pauseSeq: number, runs: readonly RunRef[]): Promise<void>
  pause(participant: PauseParticipant, owner: RunPauseOwner, deadlineAt?: number): Promise<
    { readonly kind: "held"; readonly childSeq: number } | { readonly kind: "settled" } | { readonly kind: "pending" } | RemoteResult>
  dispatchGuidance(parentSessionId: string, pauseSeq: number, resumeId: string): Promise<void>
  // `credential` is undefined only when a later Resume retries a lost participant after a restart,
  // when admission is already open and no resume transaction is live.
  resume(participant: PauseParticipant, request: ResumeParticipantRequest, credential: ResumeCredential | undefined, deadlineAt?: number): Promise<
    { readonly kind: "resumed"; readonly turnId?: string } | { readonly kind: "held_by_user"; readonly childSeq: number }
    | { readonly kind: "settled" } | RemoteResult>
  // The fresh record says another live process (or a sibling manager here) holds this child (#12349).
  isRemote?(participant: PauseParticipant): boolean
  now?(): number
  install(parentSessionId: string, pauseSeq: number, credential: ResumeCredential): Promise<void>
  acknowledgeInstalled(parentSessionId: string, pauseSeq: number, resumeId: string): Promise<void>
  cancel(participant: PauseParticipant, parentSessionId: string): Promise<void>
  // Ends the run of a participant no Resume could reach; false when it is not this host's to end.
  endLost?(participant: PauseParticipant, reason: string): Promise<boolean>
  // The child's engine view of this parent's hold; undefined when it reports none.
  observeHold?(participant: PauseParticipant, parentSessionId: string): Promise<ObservedHold | undefined>
}

function ownedElsewherePid(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "paused_child_owned_elsewhere") return undefined
  return "ownerPid" in error && typeof error.ownerPid === "number" ? error.ownerPid : undefined
}

type ResumeTransaction = { readonly pauseSeq: number; readonly resumeId: string; readonly credential: ResumeCredential }

export type ResumeFailure = { readonly key: string; readonly reason: string }
export type RunResumeResult = { readonly kind: "installed" | "superseded"; readonly failures?: readonly ResumeFailure[] }

export class RunPauseController {
  readonly #resuming = new Map<string, ResumeTransaction>()
  readonly #released = new Map<string, ResumeTransaction>()

  constructor(readonly registry: PauseRegistry, readonly effects: RunPauseEffects) {}

  async pause(parentSessionId: string, pauseSeq: number): Promise<void> {
    // Close before reading disk, enumerating children, or invoking any asynchronous effect.
    const admissions = this.registry.barrier.close(parentSessionId, pauseSeq)
    const prior = this.registry.load(parentSessionId)
    if (prior !== undefined && (prior.pauseSeq > pauseSeq || (prior.pauseSeq === pauseSeq && prior.phase !== "propagating"))) return
    this.#resuming.delete(parentSessionId)
    const record = prior?.pauseSeq === pauseSeq ? prior
      : this.registry.begin(parentSessionId, pauseSeq, this.effects.snapshot(parentSessionId, admissions))
    const quiesced = this.effects.quiesce(parentSessionId, pauseSeq)
    const runs = [...new Map(Object.values(record.participants).map(entry => [JSON.stringify(entry.runRef), entry.runRef])).values()]
    await this.effects.addFences(parentSessionId, pauseSeq, runs)
    await quiesced
    if (this.registry.require(parentSessionId).pauseSeq !== pauseSeq) return
    if (!await propagate(this.#steps(), parentSessionId, pauseSeq)) return
    await this.effects.settleCreations?.(parentSessionId, pauseSeq)
    if (this.registry.require(parentSessionId).pauseSeq !== pauseSeq) return
    if (!await propagate(this.#steps(), parentSessionId, pauseSeq)) return
    // A participant that never acknowledged is out of the run's custody; it must never hold the
    // Stop open, or neither Resume nor a person's message could reopen admission.
    for (const participant of Object.values(this.registry.require(parentSessionId).participants)) {
      if (participant.state === "held" || participant.state === "restorable" || participant.state === "lost" || inRemoteClass(participant)) continue
      await holdOrLose(this.#steps(), parentSessionId, pauseSeq, participant, "never acknowledged the pause")
    }
    this.registry.phase(parentSessionId, pauseSeq, "applied")
  }

  // A Stop whose propagation failed may still be resumed past; the failure is kept as the reason
  // every participant that never acknowledged left the run's custody.
  recordPropagationFailure(parentSessionId: string, pauseSeq: number, error: unknown): void {
    const reason = `the Stop's propagation failed: ${error instanceof Error ? error.message : String(error)}`
    log("[senpi-task] run pause propagation failed", { parentSessionId, pauseSeq, reason })
    const record = this.registry.load(parentSessionId)
    if (record === undefined || record.pauseSeq !== pauseSeq) return
    for (const participant of Object.values(record.participants)) {
      if (participant.state !== "pending") continue
      this.registry.update(parentSessionId, pauseSeq, participant.key, { state: "lost", lostReason: reason })
    }
  }

  async resume(parentSessionId: string, pauseSeq: number, resumeId: string): Promise<RunResumeResult> {
    const requested = this.registry.requestResume(parentSessionId, pauseSeq, resumeId)
    await this.effects.dispatchGuidance(parentSessionId, pauseSeq, resumeId)
    const afterGuidance = this.registry.require(parentSessionId)
    if (afterGuidance.pauseSeq !== pauseSeq || afterGuidance.resume?.resumeId !== resumeId) return { kind: "superseded" }
    const credential = this.registry.authorizeResume(parentSessionId, pauseSeq, resumeId)
    const transaction = { pauseSeq, resumeId, credential }
    this.#resuming.set(parentSessionId, transaction)
    const failures: ResumeFailure[] = []
    const ordered = this.registry.orderedAdmissions(parentSessionId).filter(participant => participant.state !== "resumed")
    const remote = ordered.filter(participant => this.#remote(participant))
    // Every remote participant is asked at once against ONE deadline; locals keep the sequential path.
    const deadlineAt = this.#now() + REMOTE_DEADLINE_MS
    const remoteOutcomes = await Promise.all(remote.map(participant => this.#resumeOne(parentSessionId, pauseSeq, resumeId, participant,
      undefined, credential, () => this.#current(parentSessionId, transaction), deadlineAt)))
    if (remoteOutcomes.includes("superseded")) return { kind: "superseded" }
    for (const outcome of remoteOutcomes) if (outcome !== undefined && outcome !== "superseded") failures.push(outcome)
    for (const participant of ordered.filter(entry => !remote.includes(entry))) {
      if (!this.#current(parentSessionId, transaction)) return { kind: "superseded" }
      const outcome = await this.#resumeOne(parentSessionId, pauseSeq, resumeId, participant,
        requested.childSeqCutoffs[participant.key], credential, () => this.#current(parentSessionId, transaction))
      if (outcome === "superseded") return { kind: "superseded" }
      if (outcome !== undefined) failures.push(outcome)
    }
    await this.effects.install(parentSessionId, pauseSeq, credential)
    if (!this.#current(parentSessionId, transaction)) return { kind: "superseded" }
    await this.effects.acknowledgeInstalled(parentSessionId, pauseSeq, resumeId)
    const record = this.registry.require(parentSessionId)
    if (record.pauseSeq !== pauseSeq || record.resume?.resumeId !== resumeId) return { kind: "superseded" }
    return failures.length === 0 ? { kind: "installed" } : { kind: "installed", failures }
  }

  // A later Resume at the same Stop (a repeated resumed change, or the reconcile after a restart):
  // admission is already open, so only the participants still outside the run's custody are retried.
  async retryLost(parentSessionId: string, pauseSeq: number): Promise<readonly ResumeFailure[]> {
    const record = this.registry.load(parentSessionId)
    if (record === undefined || record.pauseSeq !== pauseSeq || record.phase !== "resumed") return []
    if (this.registry.barrier.state(parentSessionId).kind !== "open") return []
    const released = this.#released.get(parentSessionId)
    const credential = released?.pauseSeq === pauseSeq ? released.credential : undefined
    const resumeId = record.resume?.resumeId ?? `parent-resume:${pauseSeq}`
    const failures: ResumeFailure[] = []
    const current = () => {
      const latest = this.registry.load(parentSessionId)
      return latest?.pauseSeq === pauseSeq && latest.phase === "resumed" && this.registry.barrier.state(parentSessionId).kind === "open"
    }
    for (const participant of this.registry.orderedAdmissions(parentSessionId)) {
      if (participant.kind === "held_admission" || !retriedAsRemote(participant, this.effects.isRemote?.(participant) === true)) continue
      const outcome = await this.#resumeOne(parentSessionId, pauseSeq, resumeId, participant, undefined, credential, current, this.#now() + REMOTE_DEADLINE_MS)
      if (outcome === "superseded") break
      if (outcome !== undefined) failures.push(outcome)
    }
    return failures
  }

  hasLost(parentSessionId: string, pauseSeq: number): boolean {
    const record = this.registry.load(parentSessionId)
    return record?.pauseSeq === pauseSeq && record.phase === "resumed"
      && Object.values(record.participants).some(participant => participant.state === "lost")
  }

  // A remote participant whose desired state is not acknowledged yet keeps the ack watcher running (design 3.2).
  hasRemote(parentSessionId: string): boolean {
    const record = this.registry.load(parentSessionId)
    return record !== undefined && Object.values(record.participants).some(participant => inRemoteClass(participant))
  }

  // After the bounded retries a released Resume still could not reach these participants: each run
  // ends with its reason, so no child stays paused under a Stop nobody holds any more (#12249).
  async endLost(parentSessionId: string, pauseSeq: number): Promise<readonly ResumeFailure[]> {
    const failures: ResumeFailure[] = []
    const record = this.registry.load(parentSessionId)
    if (record === undefined || record.pauseSeq !== pauseSeq || record.phase !== "resumed" || this.effects.endLost === undefined) return failures
    for (const participant of Object.values(record.participants)) {
      if (participant.state !== "lost" || this.effects.isRemote?.(participant) === true) continue
      const reason = participant.lostReason ?? "never acknowledged the pause"
      try {
        if (await this.effects.endLost(participant, reason)) this.registry.drop(parentSessionId, pauseSeq, participant.key)
      } catch (error) {
        failures.push({ key: participant.key, reason: `ending the lost run failed: ${error instanceof Error ? error.message : String(error)}` })
      }
    }
    return failures
  }

  // An acknowledged child's durable cutoff also survives a failed restore: there may be no live
  // engine to observe yet. Never let one unavailable child prevent the parent's Resume.
  async #resumeOne(
    parentSessionId: string, pauseSeq: number, resumeId: string, participant: PauseParticipant,
    frozenCutoff: number | undefined, credential: ResumeCredential | undefined, current: () => boolean, deadlineAt?: number,
  ): Promise<ResumeFailure | "superseded" | undefined> {
    // Classified BEFORE the lost skip and the cutoff rule: a remote child's cutoff is its owner's (design 3.2).
    if (participant.kind !== "held_admission" && (inRemoteClass(participant) || this.effects.isRemote?.(participant) === true)) {
      return resumeRemote(this.#steps(), { parentSessionId, pauseSeq, resumeId, participant, credential, current, deadlineAt })
    }
    const outsideCustody = participant.state === "lost" || participant.state === "pending"
    const acknowledged = participant.ackSeq === pauseSeq && participant.observedChildSeq !== undefined
    let cutoff = frozenCutoff ?? (acknowledged ? participant.observedChildSeq : undefined)
    if (outsideCustody && !acknowledged && participant.kind !== "held_admission") {
      const observed = await observe(this.#steps(), parentSessionId, participant)
      if (!current()) return "superseded"
      if (observed?.held !== true) {
        const lostReason = participant.lostReason ?? "never acknowledged the pause"
        log("[senpi-task] run resume skips a lost participant", { parentSessionId, pauseSeq, key: participant.key, lostReason })
        if (participant.state === "pending") this.registry.update(parentSessionId, pauseSeq, participant.key, { state: "lost", lostReason })
        return undefined
      }
      cutoff = observed.childSeq
    }
    if (participant.kind !== "held_admission" && cutoff === undefined) throw new Error(`missing pause acknowledgement for ${participant.key}`)
    this.registry.update(parentSessionId, pauseSeq, participant.key, { state: "resuming" })
    let result: Awaited<ReturnType<RunPauseEffects["resume"]>>
    try {
      result = await this.effects.resume(participant, {
        parentSessionId, parentPauseSeq: pauseSeq, resumeId, runRef: participant.runRef,
        ...(cutoff === undefined ? {} : { childSeqCutoff: cutoff }),
      }, credential)
    } catch (error) {
      const ownerPid = ownedElsewherePid(error)
      if (ownerPid !== undefined) {
        // Another live host holds the child: it is that host's run, not a lost one, and never ended here.
        log("[senpi-task] run resume left a child its live owner holds", { parentSessionId, pauseSeq, key: participant.key, ownerPid })
        this.registry.update(parentSessionId, pauseSeq, participant.key, { state: "owned_elsewhere", ownerPid, lostReason: undefined })
        return current() ? { key: participant.key, reason: `owned_elsewhere: held by live host ${ownerPid}` } : "superseded"
      }
      const reason = `resume failed: ${error instanceof Error ? error.message : String(error)}`
      log("[senpi-task] run resume failed for a lost participant", { parentSessionId, pauseSeq, key: participant.key, reason })
      this.registry.update(parentSessionId, pauseSeq, participant.key, { state: "lost", lostReason: reason })
      return current() ? { key: participant.key, reason } : "superseded"
    }
    if (!current()) return "superseded"
    if (result.kind === "remote") {
      writeRemote(this.registry, parentSessionId, pauseSeq, participant.key, result)
      return remoteFailure(participant.key, result)
    }
    if (result.kind === "settled") this.registry.drop(parentSessionId, pauseSeq, participant.key)
    else if (result.kind === "held_by_user") this.registry.update(parentSessionId, pauseSeq, participant.key, {
      state: "held_by_user", observedChildSeq: result.childSeq,
    })
    else this.registry.update(parentSessionId, pauseSeq, participant.key, {
      state: "resumed", lostReason: undefined, ownerPid: undefined, ...(result.turnId === undefined ? {} : { resumeTurnId: result.turnId }),
    })
    return undefined
  }

  // The ack watcher's tick while the Stop is in effect: re-assert each remote participant's register,
  // fold its ack, and hand a participant whose owner died to the local pause (design 3.2).
  async refreshRemote(parentSessionId: string, pauseSeq: number): Promise<void> {
    const record = this.registry.load(parentSessionId)
    if (record === undefined || record.pauseSeq !== pauseSeq || (record.phase !== "propagating" && record.phase !== "applied")) return
    const remote = Object.values(record.participants).filter(participant => inRemoteClass(participant))
    const deadlineAt = this.#now()
    await Promise.all(remote.map(participant => pauseRemote(this.#steps(), parentSessionId, pauseSeq, participant, deadlineAt)))
  }

  #remote(participant: PauseParticipant): boolean {
    return participant.kind !== "held_admission" && (inRemoteClass(participant) || this.effects.isRemote?.(participant) === true)
  }

  #steps() {
    return { registry: this.registry, effects: this.effects, now: () => this.#now() }
  }

  #now(): number {
    return this.effects.now?.() ?? Date.now()
  }

  released(parentSessionId: string, pauseSeq: number, resumeId: string): boolean {
    const transaction = this.#resuming.get(parentSessionId)
    if (transaction?.pauseSeq !== pauseSeq || transaction.resumeId !== resumeId) return false
    if (!this.registry.barrier.release(parentSessionId, transaction.credential)) return false
    this.registry.phase(parentSessionId, pauseSeq, "resumed")
    this.#resuming.delete(parentSessionId)
    this.#released.set(parentSessionId, transaction)
    return true
  }

  // The control inbox released this parent's Stop through the owner's own barrier (#12349): record it as
  // released without writing the shared ledger, so a later Resume of that Stop here is a no-op.
  noteRemoteRelease(parentSessionId: string, pauseSeq: number, resumeId: string, credential: ResumeCredential): void {
    this.#resuming.delete(parentSessionId)
    this.#released.set(parentSessionId, { pauseSeq, resumeId, credential })
  }

  releasedSeq(parentSessionId: string): number | undefined {
    return this.#released.get(parentSessionId)?.pauseSeq
  }

  async cancel(parentSessionId: string, runRef: RunRef): Promise<void> {
    const selected = Object.values(this.registry.require(parentSessionId).participants)
      .filter(entry => JSON.stringify(entry.runRef) === JSON.stringify(runRef))
    for (const participant of selected) {
      await this.effects.cancel(participant, parentSessionId)
      const current = this.registry.require(parentSessionId)
      this.registry.drop(parentSessionId, current.pauseSeq, participant.key)
    }
  }

  #current(parentSessionId: string, transaction: ResumeTransaction): boolean {
    const state = this.registry.barrier.state(parentSessionId)
    return this.#resuming.get(parentSessionId) === transaction && state.kind === "resuming"
      && state.pauseSeq === transaction.pauseSeq && state.resumeId === transaction.resumeId
      && this.registry.require(parentSessionId).pauseSeq === transaction.pauseSeq
  }
}
