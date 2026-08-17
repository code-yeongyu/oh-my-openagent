import { hostname } from "node:os"
import { getPidLiveness, getProcessStartIdentity, type ProcessLiveness } from "../locks"
import type { ReservedRun } from "./machine"

// A reservation is published before its run launches, and the reserving process may legitimately
// exit before the run it queued is started by another process. Pid death only proves abandonment
// once the reservation has outlived the same grace crash reconciliation waits out.
export const RESERVATION_PRELAUNCH_GRACE_MS = 60_000

// deadlineAt is the instant the supervisor sends SIGKILL, not the instant the run is finished:
// the launcher still has to validate the worktree, integrate it into the memory repo, clean up
// and publish a completion. Reclaiming at the deadline itself takes the lock away from a run that
// is finishing normally, so a live launcher is given a bounded finalization window past it.
export const RESERVATION_FINALIZATION_GRACE_MS = 10 * 60_000

export type ReflectionReclaimReason = "deadline_expired" | "launcher_dead" | "launcher_replaced"

export interface ReflectionReclaimedReservation {
  readonly run: ReservedRun
  readonly reason: ReflectionReclaimReason
  readonly detail?: string
}

export interface ReflectionReclaimSeams {
  readonly now: () => Date
  readonly getRunDeadline: (runId: string) => Promise<number | undefined>
  readonly getPidLiveness?: (pid: number) => ProcessLiveness
  readonly getProcessStartIdentity?: (pid: number) => Promise<string | null>
  readonly localHostname?: () => string
}

type LauncherState = "alive" | "dead" | "replaced" | "unverifiable"

export async function findStaleReservation(
  active: ReservedRun | undefined,
  seams: ReflectionReclaimSeams,
): Promise<ReflectionReclaimedReservation | undefined> {
  if (active === undefined || active.reservedAt === undefined) return undefined
  const nowMs = seams.now().getTime()
  const reservedAt = Date.parse(active.reservedAt)
  const age = Number.isNaN(reservedAt) ? Number.POSITIVE_INFINITY : nowMs - reservedAt
  const launcher = await classifyLauncher(active, seams)
  if (age > RESERVATION_PRELAUNCH_GRACE_MS) {
    if (launcher === "dead") {
      return { run: active, reason: "launcher_dead", detail: `launcher pid ${active.launcherPid} is gone` }
    }
    if (launcher === "replaced") {
      return {
        run: active,
        reason: "launcher_replaced",
        detail: `pid ${active.launcherPid} was recycled by another process`,
      }
    }
  }
  const deadlineAt = await seams.getRunDeadline(active.runId)
  if (deadlineAt === undefined || nowMs <= deadlineAt + RESERVATION_FINALIZATION_GRACE_MS) return undefined
  return {
    run: active,
    reason: "deadline_expired",
    detail: `run deadline ${new Date(deadlineAt).toISOString()} passed and finalization did not complete`,
  }
}

async function classifyLauncher(
  active: ReservedRun,
  seams: ReflectionReclaimSeams,
): Promise<LauncherState> {
  const localHost = (seams.localHostname ?? hostname)()
  if (active.launcherPid === undefined || active.launcherHostname !== localHost) return "unverifiable"
  const liveness = (seams.getPidLiveness ?? getPidLiveness)(active.launcherPid)
  if (liveness === "dead") return "dead"
  if (liveness !== "alive") return "unverifiable"
  if (active.launcherProcessStart === undefined || active.launcherProcessStart === null) return "alive"
  const actual = await (seams.getProcessStartIdentity ?? getProcessStartIdentity)(active.launcherPid)
  if (actual === null) return "alive"
  return actual === active.launcherProcessStart ? "alive" : "replaced"
}
