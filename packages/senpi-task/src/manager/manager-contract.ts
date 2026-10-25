import type { DagTaskOwner, DagTaskOwnerKey, OwnedStartResult } from "../dag/owner"
import type { ResumeCredential } from "../pause/admission-barrier"
import type { PauseParticipant } from "../pause/registry"
import type { LiveRunStats, TaskRecord, TaskRunStats } from "../state"
import type { CancelOptions, CancelOutcome, InterruptOutcome, RedispatchOutcome, SendInput, SendOutcome } from "../steering"
import type { WorkpoolEngine } from "../workpool/engine"
import type { ManagedChildHandle, ManagedChildListener } from "./child-handle"
import type { TaskConcurrency } from "./concurrency"
import type { HeldAdmissionResult } from "./held-admissions"
import type { ContinueResult, ForgetOptions, ListScope, ListedTask, ManagerStartSpec, StartResult } from "./types"

export type TaskManager = {
  readonly workpools?: WorkpoolEngine
  // Optional for structural adapters; the concrete manager exposes its live lease allocator.
  readonly concurrency?: TaskConcurrency
  withdrawAdmissions?(taskIds: readonly string[]): void
  resumeHeldTask?(participant: PauseParticipant, credential: ResumeCredential): Promise<HeldAdmissionResult>
  findTaskByChildSession?(sessionId: string): TaskRecord | undefined
  start(spec: ManagerStartSpec): Promise<StartResult>
  // Settles once the task's in-flight launch settles (a `starting` result keeps launching, #10042).
  whenLaunched?(taskId: string): Promise<void>
  /** Bounded wait for in-flight first launches at session shutdown; later admissions are discarded. */
  settleLaunchesForShutdown?(boundMs: number): Promise<void>
  startOwned(spec: ManagerStartSpec, owner: DagTaskOwner): Promise<OwnedStartResult>
  findOwnedTask(owner: DagTaskOwnerKey): TaskRecord | undefined
  continueTask(taskIdOrName: string, prompt: string, deliverAs?: "steer" | "followUp"): Promise<ContinueResult>
  sendToTask(input: SendInput): Promise<SendOutcome>
  interruptTask(idOrName: string): Promise<InterruptOutcome>
  cancelTask(idOrName: string, reason?: string, options?: CancelOptions): Promise<CancelOutcome>
  // senpi#3266: one-step re-dispatch of a flagged "resumed, waiting for input" task onto a fresh
  // live session, replaying its persisted prompt under the same task identity and a new run epoch.
  // Optional: minimal manager fakes (and the DAG test doubles) never serve a redispatch.
  redispatchTask?(idOrName: string, callerSessionId?: string): Promise<RedispatchOutcome>
  get(taskId: string): TaskRecord | undefined
  hasPendingSends?(taskId: string): boolean
  hasInFlightSends?(taskId: string): boolean
  tryClaimEviction?(taskId: string): boolean
  releaseEviction?(taskId: string): void
  isEvicting?(taskId: string): boolean
  tryBeginSend?(taskId: string): boolean
  endSend?(taskId: string): void
  list(scope: ListScope): readonly ListedTask[]
  waitFor(taskId: string, options?: { readonly signal?: AbortSignal }): Promise<TaskRecord>
  // Live read of the manager-owned run-stats accumulator. Snapshot and live TUI surfaces need
  // in-flight turns/tool-calls/tok-s; the record only carries run_stats once terminal.
  // Optional so downstream structural fakes keep compiling; the concrete manager always implements it.
  runStatsSnapshot?(taskId: string): TaskRunStats | undefined
  // The same live stats tagged with the run they measure, so a consumer reading records too never counts a run twice.
  liveRunStats?(taskId: string): LiveRunStats | undefined
  // W1-V F3: prune a live handle (and its per-epoch release/background bookkeeping) so the lifecycle
  // destruction port and eviction path never leave a stale handle behind or grow #live unbounded.
  forget(taskId: string, options: ForgetOptions): void
  // Live-handle read seam for the wiring's ResidencyRegistry (W1-V F7: registry and #live share one
  // forget path). Returns the ManagedChildHandle for a task this process still owns, if any.
  getResidentHandle(taskId: string): ManagedChildHandle | undefined
  // Subscribe at the runner-agnostic handle seam now or when a queued task is promoted.
  subscribeChild(taskId: string, listener: ManagedChildListener): () => void
  residentTaskIds(): readonly string[]
  // #8396: session-scoped residency wake. Resolves the next time the parent session's residency
  // picture changes - a resident child reaches a terminal status, is forgotten (evicted, suspended,
  // destroyed), or has its last pending send drained - so a caller denied for residency can park
  // and re-probe instead of judging the SESSION by its own bookkeeping. Repeatable: each call arms
  // the NEXT change, so arm it BEFORE the probe whose denial you intend to wait out.
  residencyChanged(parentSessionId: string): Promise<void>
  // Promote a foreground task when the tool stops waiting inline. The completion bridge reads this
  // state live at terminal transition, so promotion makes the eventual completion notify normally.
  promoteToBackground(taskId: string): boolean
  // Whether a task is currently background, either from its spawn spec or a later promotion.
  wasBackground(taskId: string): boolean
}
