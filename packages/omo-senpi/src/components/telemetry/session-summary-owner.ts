import { randomUUID } from "node:crypto"
import { join } from "node:path"

import { writeJsonAtomic } from "./session-summary-files"
import { readProcessStartTime } from "./session-summary-process-start"

export type ProcessOwner = { readonly pid: number; readonly bootId: string }

/** Random per loaded module instance, so a reused pid never passes for the process that wrote a file. */
export const PROCESS_BOOT_ID = randomUUID()

export function currentProcessOwner(): ProcessOwner {
  return { pid: process.pid, bootId: PROCESS_BOOT_ID }
}

export type OwnerRegistryInput = {
  readonly dir: string
  readonly owner: ProcessOwner
  /** Start-time probe; defaults to the real one. Injected by tests that simulate pid reuse. */
  readonly processStartTime?: (pid: number) => string | null
  readonly now?: () => number
}

/**
 * `owners/<pid>.json` holds the boot id, the process start time and a heartbeat of the OmO process that
 * wrote it. The start time recorded is the WRITING process's (`processStartTime(process.pid)`), because only
 * the owner itself writes its entry. Telling a live owner from a dead one is recovery's job
 * (`session-summary-liveness.ts`, in the recovery sidecar); writing the entry is the only part every run needs.
 */
export function createOwnerRegistry(input: OwnerRegistryInput): { readonly register: () => void } {
  const startTimeOf = input.processStartTime ?? readProcessStartTime
  const now = input.now ?? Date.now
  let ownStartTime: string | null | undefined
  return {
    register() {
      ownStartTime ??= startTimeOf(process.pid)
      const entry = { pid: input.owner.pid, bootId: input.owner.bootId, startTime: ownStartTime, heartbeatAt: now() }
      writeJsonAtomic(ownerEntryPath(input.dir, input.owner.pid), entry, input.owner)
    },
  }
}

export function ownerEntryPath(dir: string, pid: number): string {
  return join(dir, "owners", `${pid}.json`)
}

export function parseOwner(value: unknown): ProcessOwner | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const pid: unknown = Reflect.get(value, "pid")
  const bootId: unknown = Reflect.get(value, "bootId")
  return typeof pid === "number" && Number.isInteger(pid) && typeof bootId === "string" && bootId.length > 0
    ? { pid, bootId }
    : undefined
}
