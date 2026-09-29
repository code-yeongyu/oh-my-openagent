import { execFile } from "node:child_process"

import type { ProcessIdentity } from "./types"

export function processStartTime(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("ps", ["-o", "lstart=", "-p", String(pid)], { windowsHide: true, timeout: 5_000 }, (error, stdout) => {
      const value = stdout.trim()
      resolve(error !== null || value.length === 0 ? null : value)
    })
  })
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH")
  }
}

/**
 * A claimant is dead when its pid is gone or now names a process started at another time. A live
 * pid whose start time cannot be read counts as live, the same conservative rule senpi's host gc
 * applies, so a suspended or unreadable claimant is never reconciled behind its back.
 */
export async function isClaimantDead(identity: ProcessIdentity): Promise<boolean> {
  if (!pidExists(identity.pid)) return true
  if (identity.process_start_time === null) return false
  const current = await processStartTime(identity.pid)
  return current !== null && current !== identity.process_start_time
}

export function sameProcess(left: ProcessIdentity, right: ProcessIdentity): boolean {
  return left.pid === right.pid && left.process_start_time === right.process_start_time && left.instance_id === right.instance_id
}
