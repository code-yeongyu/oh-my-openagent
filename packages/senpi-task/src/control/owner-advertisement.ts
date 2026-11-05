import { readFileSync } from "node:fs"
import { listControlFiles, readControlFile, removeControlFile } from "./control-fs"
import { ownersDir } from "./control-paths"
import { parseAdvertisement } from "./control-schema"
import { removeAdvertisement, writeAdvertisement, type ControlStore } from "./control-store"

export const ADVERTISEMENT_RENEW_MS = 5_000
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
