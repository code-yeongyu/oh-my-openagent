import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { AdmissionBarrier, type AdmissionState } from "./admission-barrier"
import type { RunRef } from "./ports"

export type PauseParticipant = {
  readonly key: string
  readonly kind: "dag_node" | "task" | "workpool_worker" | "team_member" | "held_admission"
  readonly runRef: RunRef
  readonly taskId?: string
  readonly nodeId?: string
  readonly runEpoch?: number
  readonly admission?: {
    readonly model: string
    readonly laneKey: string
    readonly sequence: number
    readonly phase: "pre_grant" | "post_grant" | "parked"
  }
  readonly state: "pending" | "held" | "resuming" | "resumed" | "held_by_user" | "restorable" | "lost"
  readonly ackSeq?: number
  readonly observedChildSeq?: number
  readonly resumeTurnId?: string
  // Why a participant left the run's custody without acknowledging the pause.
  readonly lostReason?: string
  readonly at: string
}

export type PauseRegistryRecord = {
  readonly parentSessionId: string
  readonly pauseSeq: number
  readonly phase: "propagating" | "applied" | "resuming" | "resumed"
  readonly barrier: AdmissionState
  readonly participants: Readonly<Record<string, PauseParticipant>>
  readonly resume?: {
    readonly resumeId: string
    readonly childSeqCutoffs: Readonly<Record<string, number>>
    readonly installed?: true
  }
}

export class PauseRegistry {
  constructor(readonly stateDir: string, readonly barrier: AdmissionBarrier) {}

  #path(parentSessionId: string): string {
    if (!parentSessionId || parentSessionId === "." || parentSessionId === ".." || /[\\/\0:]/.test(parentSessionId)) {
      throw new Error("invalid pause registry session id")
    }
    return join(this.stateDir, "pause", `${parentSessionId}.json`)
  }

  load(parentSessionId: string): PauseRegistryRecord | undefined {
    let text: string
    try { text = readFileSync(this.#path(parentSessionId), "utf8") }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
      throw error
    }
    const record: PauseRegistryRecord = JSON.parse(text)
    if (record.parentSessionId !== parentSessionId || !Number.isSafeInteger(record.pauseSeq) || record.pauseSeq < 1
      || typeof record.participants !== "object" || record.participants === null) throw new Error("invalid pause registry")
    return record
  }

  #write(record: PauseRegistryRecord): void {
    const path = this.#path(record.parentSessionId)
    mkdirSync(join(this.stateDir, "pause"), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 })
    renameSync(temporary, path)
  }

  begin(parentSessionId: string, pauseSeq: number, participants: readonly PauseParticipant[]): PauseRegistryRecord {
    // No I/O precedes the synchronous close.
    this.barrier.close(parentSessionId, pauseSeq)
    const prior = this.load(parentSessionId)
    if (prior !== undefined && prior.pauseSeq >= pauseSeq) return prior
    const record: PauseRegistryRecord = {
      parentSessionId, pauseSeq, phase: "propagating", barrier: { kind: "closed", pauseSeq },
      participants: Object.fromEntries(participants.map(participant => [participant.key, participant])),
    }
    this.#write(record)
    return record
  }

  restore(parentSessionId: string, ledger: {
    readonly pauseSeq: number
    readonly superseded?: boolean
    readonly requestedResumeId?: string
    readonly rebuild?: () => readonly PauseParticipant[]
  }): PauseRegistryRecord {
    let record = this.load(parentSessionId)
    if (record === undefined || record.pauseSeq < ledger.pauseSeq) {
      this.barrier.close(parentSessionId, ledger.pauseSeq)
      record = this.begin(parentSessionId, ledger.pauseSeq, ledger.rebuild?.() ?? [])
    }
    this.barrier.restore(parentSessionId, record.barrier, {
      newestSeq: ledger.pauseSeq, superseded: ledger.superseded === true,
    })
    if (ledger.requestedResumeId !== undefined && ledger.superseded !== true) {
      this.requestResume(parentSessionId, ledger.pauseSeq, ledger.requestedResumeId)
      record = this.require(parentSessionId)
    }
    if (record.barrier !== this.barrier.state(parentSessionId)) {
      record = { ...record, barrier: this.barrier.state(parentSessionId) }
      this.#write(record)
    }
    return record
  }

  require(parentSessionId: string): PauseRegistryRecord {
    const record = this.load(parentSessionId)
    if (record === undefined) throw new Error("parent has no pause registry")
    return record
  }

  update(parentSessionId: string, pauseSeq: number, key: string, patch: Partial<PauseParticipant>): boolean {
    const record = this.require(parentSessionId)
    const participant = record.participants[key]
    if (record.pauseSeq !== pauseSeq || participant === undefined) return false
    this.#write({ ...record, participants: { ...record.participants, [key]: { ...participant, ...patch, key } } })
    return true
  }

  add(parentSessionId: string, pauseSeq: number, participant: PauseParticipant): boolean {
    const record = this.require(parentSessionId)
    if (record.pauseSeq !== pauseSeq || record.phase === "resumed") return false
    this.#write({ ...record, participants: { ...record.participants, [participant.key]: participant } })
    return true
  }

  phase(parentSessionId: string, pauseSeq: number, phase: PauseRegistryRecord["phase"]): boolean {
    const record = this.require(parentSessionId)
    if (record.pauseSeq !== pauseSeq) return false
    this.#write({ ...record, phase, barrier: this.barrier.state(parentSessionId) })
    return true
  }

  requestResume(parentSessionId: string, pauseSeq: number, resumeId: string): NonNullable<PauseRegistryRecord["resume"]> {
    const record = this.require(parentSessionId)
    if (record.pauseSeq !== pauseSeq) throw new Error("stale resume sequence")
    if (record.resume?.resumeId === resumeId) return record.resume
    const resume = {
      resumeId,
      childSeqCutoffs: Object.fromEntries(Object.values(record.participants)
        .flatMap(participant => participant.observedChildSeq === undefined ? [] : [[participant.key, participant.observedChildSeq]])),
    }
    this.#write({ ...record, phase: "resuming", resume })
    return resume
  }

  markInstalled(parentSessionId: string, pauseSeq: number, resumeId: string): boolean {
    const record = this.require(parentSessionId)
    if (record.pauseSeq !== pauseSeq || record.resume?.resumeId !== resumeId) return false
    this.#write({ ...record, resume: { ...record.resume, installed: true } })
    return true
  }

  authorizeResume(parentSessionId: string, pauseSeq: number, resumeId: string) {
    const credential = this.barrier.resume(parentSessionId, pauseSeq, resumeId)
    this.phase(parentSessionId, pauseSeq, "resuming")
    return credential
  }

  drop(parentSessionId: string, pauseSeq: number, key: string): boolean {
    const record = this.require(parentSessionId)
    if (record.pauseSeq !== pauseSeq) return false
    const { [key]: _removed, ...participants } = record.participants
    this.#write({ ...record, participants })
    return true
  }

  orderedAdmissions(parentSessionId: string): readonly PauseParticipant[] {
    return Object.values(this.require(parentSessionId).participants).toSorted((a, b) =>
      Number(a.admission?.phase !== "parked") - Number(b.admission?.phase !== "parked")
      || (a.admission?.sequence ?? 0) - (b.admission?.sequence ?? 0)
      || a.key.localeCompare(b.key))
  }
}
