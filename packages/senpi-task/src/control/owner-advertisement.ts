import { readFileSync } from "node:fs"
import { listControlFiles, removeControlFile } from "./control-fs"
import { ownersDir } from "./control-paths"
import { parseAdvertisement, type OwnerAdvertisement } from "./control-schema"
import { readAdvertisement, removeAdvertisement, writeAdvertisement, type ControlStore } from "./control-store"
import { readControlFile } from "./control-fs"

export const ADVERTISEMENT_RENEW_MS = 5_000
export const ADVERTISEMENT_LIVE_MS = 15_000
const DAY_MS = 24 * 60 * 60 * 1000

// Linux exposes a process's start (clock ticks since boot) in /proc; elsewhere it is not read and
// the liveness check rests on the renewal age and the pid.
export function readProcessStartTime(pid: number, platform: NodeJS.Platform = process.platform): number | undefined {
  if (platform !== "linux") return undefined
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
    const start = Number(fields[19])
    return Number.isSafeInteger(start) ? start : undefined
  } catch { return undefined }
}

export type AdvertisementLiveness = {
  readonly now: () => number
  readonly isProcessAlive: (pid: number) => boolean
  readonly processStartTime?: (pid: number) => number | undefined
}

// LIVE answers only "is there a reader for a register addressed to this child"; it never declares
// a process dead (design 3.1.3).
export function isAdvertisementLive(advertisement: OwnerAdvertisement, liveness: AdvertisementLiveness): boolean {
  const renewed = Date.parse(advertisement.renewedAt)
  if (!Number.isFinite(renewed) || liveness.now() - renewed > ADVERTISEMENT_LIVE_MS) return false
  if (!liveness.isProcessAlive(advertisement.pid)) return false
  const recorded = advertisement.processStartTime
  const current = recorded === undefined ? undefined : liveness.processStartTime?.(advertisement.pid)
  return recorded === undefined || current === undefined || recorded === current
}

export function liveAdvertisementFor(control: ControlStore, pid: number, managerInstance: string | undefined,
  liveness: AdvertisementLiveness): OwnerAdvertisement | undefined {
  if (managerInstance !== undefined) {
    const exact = readAdvertisement(control, pid, managerInstance)
    return exact !== undefined && isAdvertisementLive(exact, liveness) ? exact : undefined
  }
  for (const { name } of listControlFiles(ownersDir(control.stateDir), control.env)) {
    if (!name.startsWith(`${pid}-`)) continue
    const read = readControlFile(ownersDir(control.stateDir), name, control.env)
    const advertisement = read.kind === "ok" ? parseAdvertisement(read.text) : undefined
    if (advertisement?.pid === pid && isAdvertisementLive(advertisement, liveness)) return advertisement
  }
  return undefined
}

export function renewAdvertisement(control: ControlStore, input: {
  readonly pid: number; readonly managerInstance: string; readonly sessionId: string; readonly now: number
  readonly processStartTime: number | undefined
}): boolean {
  return writeAdvertisement(control, {
    version: 1, pid: input.pid, managerInstance: input.managerInstance, sessionId: input.sessionId,
    renewedAt: new Date(input.now).toISOString(), ...(input.processStartTime === undefined ? {} : { processStartTime: input.processStartTime }),
  })
}

export function withdrawAdvertisement(control: ControlStore, pid: number, managerInstance: string): void {
  removeAdvertisement(control, pid, managerInstance)
}

export function sweepAdvertisements(control: ControlStore, now: number): void {
  const dir = ownersDir(control.stateDir)
  for (const { name } of listControlFiles(dir, control.env)) {
    const read = readControlFile(dir, name, control.env)
    const advertisement = read.kind === "ok" ? parseAdvertisement(read.text) : undefined
    const renewed = advertisement === undefined ? Number.NaN : Date.parse(advertisement.renewedAt)
    if (Number.isFinite(renewed) && now - renewed <= DAY_MS) continue
    if (read.kind === "ok" && now - read.mtimeMs <= DAY_MS) continue
    removeControlFile(dir, name)
  }
}
