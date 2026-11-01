import { readFile } from "node:fs/promises"

import { readDarwinProcessStartSeconds, readWin32ProcessCreationFiletime } from "@oh-my-opencode/memory-core/process-start-time"

import type { TaskRecord } from "../state"

/** Epoch ms no later than the start of the process now holding `pid`, or null when the OS cannot say. */
export type ProcessStartReader = (pid: number) => Promise<number | null>

/**
 * A record's host_pid names the process that claimed it, but a bare pid probe cannot tell that
 * process from a later one the OS gave the same pid. The claimant stamps `host_claim` itself, no
 * earlier than it started, so a process that started after that stamp is never its owner.
 */
export type OwnerProcessView = {
  observe(pid: number): Promise<void>
  startedAfter(pid: number, atMs: number): boolean
}

// FILETIME counts 100 ns ticks from 1601-01-01; the Unix epoch is this many ticks later.
const FILETIME_UNIX_EPOCH = 116_444_736_000_000_000n
// /proc/stat btime is recomputed from the wall clock and can move by about a second under NTP slew.
const LINUX_BTIME_SLACK_MS = 2_000
const LINUX_CLOCK_TICKS_PER_SECOND = 100

async function readLinuxStartMs(pid: number): Promise<number | null> {
  try {
    const [stat, system] = await Promise.all([readFile(`/proc/${pid}/stat`, "utf8"), readFile("/proc/stat", "utf8")])
    const ticks = Number(stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19])
    const bootSeconds = Number(/^btime (\d+)$/m.exec(system)?.[1])
    if (!Number.isFinite(ticks) || !Number.isFinite(bootSeconds)) return null
    return (bootSeconds + ticks / LINUX_CLOCK_TICKS_PER_SECOND) * 1000 - LINUX_BTIME_SLACK_MS
  } catch {
    return null
  }
}

export const readProcessStartLowerBoundMs: ProcessStartReader = async (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  if (process.platform === "darwin") {
    const seconds = await readDarwinProcessStartSeconds(pid)
    return seconds === null ? null : seconds * 1000
  }
  if (process.platform === "win32") {
    const filetime = await readWin32ProcessCreationFiletime(pid)
    return filetime === null ? null : Number((filetime - FILETIME_UNIX_EPOCH) / 10_000n)
  }
  if (process.platform === "linux") return await readLinuxStartMs(pid)
  return null
}

export function createOwnerProcessView(read: ProcessStartReader): OwnerProcessView {
  // Every start ever seen for a pid belonged to a process holding it at that moment, so the latest
  // one is still a sound bound even after the pid changes hands again.
  const starts = new Map<number, number>()
  return {
    async observe(pid) {
      const start = await read(pid).catch(() => null)
      if (start === null || !Number.isFinite(start)) return
      starts.set(pid, Math.max(starts.get(pid) ?? start, start))
    },
    startedAfter(pid, atMs) {
      const start = starts.get(pid)
      return start !== undefined && Number.isFinite(atMs) && start > atMs
    },
  }
}

export const defaultOwnerProcessView: OwnerProcessView = createOwnerProcessView(readProcessStartLowerBoundMs)

// An injected liveness probe answers for pids that are not real processes here; real start times would
// contradict it, so such a caller learns nothing from the OS unless it injects its own view too.
export const NO_START_EVIDENCE: OwnerProcessView = { observe: async () => undefined, startedAfter: () => false }

export function ownerProcessViewFor(injectedLiveness: unknown, injectedView: OwnerProcessView | undefined): OwnerProcessView {
  return injectedView ?? (injectedLiveness === undefined ? defaultOwnerProcessView : NO_START_EVIDENCE)
}

/**
 * True only while the process that claimed `record` can still be running under its host_pid. Without
 * the owner's own stamp for that pid there is no evidence against a live pid, so it stays the owner.
 */
export function recordOwnerAlive(isAlive: (pid: number) => boolean, view: OwnerProcessView, record: TaskRecord): boolean {
  const pid = record.host_pid
  if (pid === undefined || !isAlive(pid)) return false
  const claim = record.host_claim
  if (claim === undefined || claim.pid !== pid) return true
  return !view.startedAfter(pid, Date.parse(claim.at))
}

// Only a foreign owner's own stamp can be contradicted, and this process can never be a reused pid.
// Undefined when nothing needs probing, so callers add no scheduling turn on the common path.
export function observeRecordOwners(view: OwnerProcessView, records: readonly TaskRecord[], ownPid: number): Promise<void> | undefined {
  const pids = new Set<number>()
  for (const record of records) {
    const pid = record.host_pid
    if (pid === undefined || pid === ownPid || pid === process.pid || record.host_claim?.pid !== pid) continue
    pids.add(pid)
  }
  if (pids.size === 0) return undefined
  return Promise.all([...pids].map((pid) => view.observe(pid))).then(() => undefined)
}
