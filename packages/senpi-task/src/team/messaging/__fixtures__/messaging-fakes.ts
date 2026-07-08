import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { TaskRecord, TaskStatus } from "../../../state"
import type { ResidencyState } from "../../../state"
import type { SendOutcome } from "../../../steering"
import type { StateDirConfig } from "../../../store"
import type { LeadMessageNotifier, LeadTeamMessage, MemberLiveHandle, MessagingDeliveryPort } from "../types"

const cleanupRoots: string[] = []

export function cleanupMessagingTmp(): void {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
}

export function tempProjectDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "senpi-team-messaging-"))
  cleanupRoots.push(directory)
  return directory
}

export function stateDirConfig(projectDir: string): StateDirConfig {
  return { project_dir: projectDir }
}

type MemberRecordOverrides = {
  readonly status?: TaskStatus
  readonly residency_state?: ResidencyState
  readonly child_session_id?: string
}

export function memberRecord(taskId: string, overrides: MemberRecordOverrides = {}): TaskRecord {
  const timestamp = new Date().toISOString()
  return {
    task_id: taskId,
    status: overrides.status ?? "running",
    residency_state: overrides.residency_state ?? "resident",
    created_at: timestamp,
    updated_at: timestamp,
    parent_session_id: "lead-session",
    root_session_id: "lead-session",
    depth: 1,
    execution_mode: "in-process",
    model: "fake/model",
    child_session_id: overrides.child_session_id ?? `sess-${taskId}`,
    notification: { run_epoch: 0, notified_epoch: -1 },
  }
}

export type SteerBehavior = "ok" | "throw"

// Structural stand-in for the manager/steering seam messaging delivers through. Records every steer
// and sendToTask call so tests can assert the running-steer path and the idle/terminal revive path,
// and can be told to throw from steer to exercise the reservation-release branch.
export class FakeDeliveryPort implements MessagingDeliveryPort {
  readonly steered: Array<{ readonly taskId: string; readonly text: string }> = []
  readonly revived: Array<{ readonly idOrName: string; readonly message: string; readonly deliverAs: "followUp" }> = []
  readonly #records = new Map<string, TaskRecord>()
  readonly #steerBehavior = new Map<string, SteerBehavior>()
  readonly #liveHandles = new Set<string>()
  readonly #sendOutcome: SendOutcome

  constructor(options: { readonly sendOutcome?: SendOutcome } = {}) {
    this.#sendOutcome = options.sendOutcome ?? { kind: "revived", task_id: "unset", run_epoch: 1 }
  }

  setMember(
    taskId: string,
    options: { readonly record?: TaskRecord; readonly steer?: SteerBehavior; readonly liveHandle?: boolean } = {},
  ): void {
    this.#records.set(taskId, options.record ?? memberRecord(taskId))
    this.#steerBehavior.set(taskId, options.steer ?? "ok")
    if (options.liveHandle !== false) this.#liveHandles.add(taskId)
  }

  get(taskId: string): TaskRecord | undefined {
    return this.#records.get(taskId)
  }

  liveHandle(taskId: string): MemberLiveHandle | undefined {
    if (!this.#liveHandles.has(taskId)) return undefined
    return {
      steer: (text: string) => {
        if (this.#steerBehavior.get(taskId) === "throw") {
          return Promise.reject(new Error(`steer boom for ${taskId}`))
        }
        this.steered.push({ taskId, text })
        return Promise.resolve()
      },
    }
  }

  sendToTask(input: { readonly idOrName: string; readonly message: string; readonly deliverAs: "followUp" }): Promise<SendOutcome> {
    this.revived.push({ idOrName: input.idOrName, message: input.message, deliverAs: input.deliverAs })
    return Promise.resolve(this.#sendOutcome)
  }
}

export type NotifierBehavior = "ok" | "throw"

// The synchronous enqueue seam for lead-direction messages. Captures every enqueued payload for the
// snapshot/routing assertions and can be told to throw to exercise the retry-then-fail contract.
export class FakeLeadNotifier implements LeadMessageNotifier {
  readonly enqueued: LeadTeamMessage[] = []
  #behavior: NotifierBehavior
  #throwsRemaining: number

  constructor(behavior: NotifierBehavior = "ok", throwsRemaining = Number.POSITIVE_INFINITY) {
    this.#behavior = behavior
    this.#throwsRemaining = throwsRemaining
  }

  enqueue(message: LeadTeamMessage): void {
    if (this.#behavior === "throw" && this.#throwsRemaining > 0) {
      this.#throwsRemaining -= 1
      throw new Error("enqueue boom")
    }
    this.enqueued.push(message)
  }
}
