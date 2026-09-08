// /doctor ghost active-reservation check: surfaces a wedged `active.lock` whose launcher is
// gone (the post-#7095 repair state reconcile now reclaims automatically at session start).

import { existsSync, readFile } from "@oh-my-opencode/memory-core/fs"
import { hostname } from "node:os"
import { join } from "node:path"

import type { DoctorCheck } from "./doctor-checks"
import { defaultIsProcessAlive, type MemoryCommandIdentity } from "./types"

const GHOST_REMEDIATION = "a current runtime reclaims it at session start; on older builds delete runtime/reflection/active.lock after confirming no reflection run is active"

export async function checkGhostReservation(
  identityPaths: MemoryCommandIdentity["identityPaths"],
  deps: { readonly isProcessAlive?: (pid: number) => boolean },
): Promise<DoctorCheck> {
  const activePath = join(identityPaths.reflection, "active.lock")
  if (!existsSync(activePath)) return { name: "reservation", level: "ok", detail: "no active reservation" }
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(activePath, "utf8"))
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { name: "reservation", level: "warn", detail: `active.lock is not valid JSON; delete it after confirming no reflection run is active` }
    }
    throw error
  }
  const record = typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {}
  const runId = typeof record.runId === "string" ? record.runId : "unknown"
  const reservedAtMs = typeof record.reservedAt === "string" ? Date.parse(record.reservedAt) : Number.NaN
  const launcherPid = typeof record.launcherPid === "number" ? record.launcherPid : undefined
  const launcherHostname = typeof record.launcherHostname === "string" ? record.launcherHostname : undefined
  if (launcherPid === undefined || launcherHostname === undefined || !Number.isFinite(reservedAtMs)) {
    return { name: "reservation", level: "warn", detail: `ghost active reservation ${runId}: launcher identity missing (pre-stamping legacy); ${GHOST_REMEDIATION}` }
  }
  if (Date.now() - reservedAtMs <= 60_000) return { name: "reservation", level: "ok", detail: `reservation ${runId} is recent` }
  if (launcherHostname !== hostname()) return { name: "reservation", level: "ok", detail: `reservation ${runId} is owned by ${launcherHostname}` }
  const alive = (deps.isProcessAlive ?? defaultIsProcessAlive)(launcherPid)
  if (alive) return { name: "reservation", level: "ok", detail: `reservation ${runId} launcher pid ${launcherPid} is alive` }
  return {
    name: "reservation",
    level: "warn",
    detail: `ghost active reservation ${runId}: launcher pid ${launcherPid} is dead (reserved ${new Date(reservedAtMs).toISOString()}); ${GHOST_REMEDIATION}`,
  }
}
