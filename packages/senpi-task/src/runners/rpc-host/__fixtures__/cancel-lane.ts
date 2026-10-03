import type { TaskRecord } from "../../../state"
import { runTaskCancel } from "../../../tools/control/cancel"
import type { FakeHost, FakeHostSession } from "./fake-host"
import { startHostWorld, type HostWorld, type ParentOptions, type ParentSession } from "./host-world"
import { manualRecoveryClock, type ManualRecoveryClock } from "./manual-recovery-clock"

/**
 * A one-host world for the cancel suites (omo#9403): a lane of `slots` children whose sessions each
 * run a real long-lived process, so "the cancel stopped the child" is the process exiting.
 */
export interface CancelLane {
  readonly world: HostWorld
  readonly parent: ParentSession
  readonly clock: ManualRecoveryClock
  readonly options: ParentOptions
}

export async function startCancelLane(worlds: HostWorld[], slots: number): Promise<CancelLane> {
  const world = await startHostWorld({ sessionProcesses: true, transcripts: true })
  worlds.push(world)
  const clock = manualRecoveryClock()
  const options: ParentOptions = { settings: { default_concurrency: slots }, reattachDelaysMs: [0, 0], recoveryClock: clock }
  return { world, parent: world.connect("parent-a", options), clock, options }
}

export function recordAt(parent: ParentSession, index: number): TaskRecord {
  const record = parent.records()[index]
  if (record === undefined) throw new Error(`no child #${index}`)
  return record
}

export function concurrencyOf(parent: ParentSession) {
  const concurrency = parent.manager.concurrency
  if (concurrency === undefined) throw new Error("the manager exposes no concurrency")
  return concurrency
}

export function sessionOf(world: HostWorld, record: TaskRecord): FakeHostSession {
  const session = world.host.sessions().find((candidate) => candidate.sessionPath === record.host_session?.session_path)
  if (session === undefined) throw new Error(`the host holds no session for ${record.task_id}`)
  return session
}

export function hostHolds(world: HostWorld, record: TaskRecord): boolean {
  return world.host.sessions().some((candidate) => candidate.sessionPath === record.host_session?.session_path)
}

/** Resolve once the host has seen `count` commands of `type`; checking and arming happen in one tick. */
export async function commandsSeen(host: FakeHost, type: string, count: number): Promise<void> {
  while (host.commands.filter((command) => command.type === type).length < count) await host.waitForCommand(type)
}

export function bounded<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} did not settle within 10s`)), 10_000)
      timer.unref?.()
    }),
  ])
}

/**
 * Drop every connection while the host keeps the sessions, and hold the reopen in flight: the child's
 * transport is down and its recovery is waiting, so a cancel now cannot reach it.
 */
export async function cutWithReopenHeld(world: HostWorld): Promise<void> {
  world.host.withholdReply("open_session")
  const reopenAsked = world.host.waitForCommand("open_session")
  world.host.cutConnections()
  await reopenAsked
}

export async function cancelUnreachable(lane: CancelLane, record: TaskRecord): Promise<void> {
  await cutWithReopenHeld(lane.world)
  const cancelled = await bounded(runTaskCancel(lane.parent.manager, { task_id: record.task_id }), "task_cancel")
  if (cancelled.details.kind !== "cancel_pending") throw new Error(`expected cancel_pending, got ${cancelled.details.kind}`)
}
