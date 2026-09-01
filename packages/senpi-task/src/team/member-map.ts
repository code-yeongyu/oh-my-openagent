import { randomUUID } from "node:crypto"
import { readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"

// Sidecar mapping of team member name -> the TaskManager `st_` id that backs it. Persisted next to
// the team-core runtime state so `deleteTeam` (and a future reconcile) can find the member tasks
// without holding process-only state.
export type MemberTaskMap = Readonly<Record<string, string>>

const MEMBER_MAP_FILE = "senpi-task-members.json"

export function memberTaskMapPath(runtimeDir: string): string {
  return join(runtimeDir, MEMBER_MAP_FILE)
}

/**
 * Atomically writes the member -> task map: a uniquely-named temp sibling is written then renamed
 * over the target, so a crash mid-write never leaves a torn or partial map on disk.
 */
export async function writeMemberTaskMap(runtimeDir: string, map: MemberTaskMap): Promise<void> {
  const target = memberTaskMapPath(runtimeDir)
  const tempPath = `${target}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(map, null, 2)}\n`, "utf8")
  await rename(tempPath, target)
}

/**
 * Reads the sidecar map. A missing file or malformed content yields an empty map so callers can
 * treat a fresh or corrupted runtime dir as "no members recorded" instead of throwing.
 */
export async function readMemberTaskMap(runtimeDir: string): Promise<MemberTaskMap> {
  try {
    const raw = await readFile(memberTaskMapPath(runtimeDir), "utf8")
    const parsed: unknown = JSON.parse(raw)
    return isStringRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  return Object.values(value).every((entry) => typeof entry === "string")
}
