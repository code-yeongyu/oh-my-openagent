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

export type Sweep = { readonly deleted: readonly string[]; readonly kept: readonly string[] }

export function sweepGuests(hypervisor: Hypervisor): Sweep {
  const pool = hypervisor.list().filter((guest) => isPoolGuest(guest.name))
  const kept = pool.filter((guest) => guest.running).map((guest) => guest.name)
  const deleted = pool.filter((guest) => !guest.running).map((guest) => deleteGuest(hypervisor, guest.name))
  return { deleted, kept }
}
