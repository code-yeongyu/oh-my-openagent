import { type GuestListing, isPoolGuest } from "./macos-vm-plan.ts"

export type Hypervisor = {
  readonly list: () => GuestListing[]
  readonly stop: (name: string) => void
  readonly remove: (name: string) => { readonly code: number; readonly stderr: string }
}

export type Teardown = { readonly lines: readonly string[]; readonly exitCode: number }

export type ProcessCount = (guestName: string) => number | null

function listed(hypervisor: Hypervisor, name: string): boolean | string {
  try {
    return hypervisor.list().some((guest) => guest.name === name)
  } catch (error) {
    return `list failed: ${error instanceof Error ? error.message : String(error)}`
  }
}

export function deleteGuest(hypervisor: Hypervisor, name: string): string {
  hypervisor.stop(name)
  const removed = hypervisor.remove(name)
  const stillListed = listed(hypervisor, name)
  if (typeof stillListed === "string") return `guest NOT DELETED ${name} (${stillListed})`
  if (stillListed) return `guest NOT DELETED ${name} (${removed.stderr || `exit ${removed.code}`})`
  return `guest DELETED ${name}`
}

export function teardown(hypervisor: Hypervisor, name: string, processCount: ProcessCount): Teardown {
  const receipt = deleteGuest(hypervisor, name)
  const procs = processCount(name)
  const lines = [`procs ${procs === null ? "UNREAD" : procs}`, receipt]
  const clean = procs === 0 && receipt.startsWith("guest DELETED")
  return { lines, exitCode: clean ? 0 : 1 }
}

export type UpStatus = "running" | "not-running" | "not-listed"

export function upStatus(listing: readonly GuestListing[], name: string): UpStatus {
  const guest = listing.find((entry) => entry.name === name)
  if (guest === undefined) return "not-listed"
  return guest.running ? "running" : "not-running"
}

export type UpWait = { readonly status: UpStatus } | { readonly status: "list-failed"; readonly detail: string }

export type Clock = { readonly now: () => number; readonly sleep: (ms: number) => Promise<void> }

const UP_POLL_MS = 2_000

export async function waitUntilRunning(
  hypervisor: Hypervisor,
  name: string,
  deadlineMs: number,
  clock: Clock,
): Promise<UpWait> {
  const deadline = clock.now() + deadlineMs
  let status: UpStatus = "not-listed"
  while (clock.now() < deadline) {
    try {
      status = upStatus(hypervisor.list(), name)
    } catch (error) {
      return { status: "list-failed", detail: error instanceof Error ? error.message : String(error) }
    }
    if (status === "running") return { status }
    await clock.sleep(UP_POLL_MS)
  }
  return { status }
}

export type Sweep = { readonly lines: readonly string[]; readonly exitCode: number }

// Why a pool guest must be kept, or null when nothing uses it. A guest an --up has cloned or started is not listed
// running yet, but its hypervisor clone/run process is live; an unreadable count is never read as idle.
function keepReason(guest: GuestListing, processCount: ProcessCount): string | null {
  if (guest.running) return "running"
  const live = processCount(guest.name)
  if (live === null) return "process count unreadable"
  if (live > 0) return `${live} hypervisor process${live === 1 ? "" : "es"} live: a run may be starting it`
  return null
}

export function sweepGuests(hypervisor: Hypervisor, processCount: ProcessCount): Sweep {
  let listing: GuestListing[]
  try {
    listing = hypervisor.list()
  } catch (error) {
    return { lines: [`sweep: list failed: ${error instanceof Error ? error.message : String(error)}`], exitCode: 1 }
  }
  const removals: string[] = []
  const kept: string[] = []
  for (const guest of listing.filter((entry) => isPoolGuest(entry.name))) {
    const reason = keepReason(guest, processCount)
    if (reason === null) removals.push(deleteGuest(hypervisor, guest.name))
    else kept.push(`guest KEPT ${guest.name} (${reason})`)
  }
  const deleted = removals.filter((line) => line.startsWith("guest DELETED")).length
  const notDeleted = removals.length - deleted
  const summary = `sweep: ${deleted} deleted, ${notDeleted} not deleted, ${kept.length} kept`
  return { lines: [...removals, ...kept, summary], exitCode: notDeleted === 0 ? 0 : 1 }
}
