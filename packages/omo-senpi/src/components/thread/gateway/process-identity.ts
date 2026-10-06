import { execFile } from "node:child_process"

import type { ProcessIdentity } from "./types"

const EPOCH_PREFIX = "epoch:"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const

/**
 * `ps -o lstart=` in the C locale at UTC, as procps and BSD ps both print it
 * (`Thu Oct  1 02:23:35 2026`), read as seconds since the epoch.
 */
export function parseLstart(text: string): number | null {
  const match = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(text.trim())
  if (match === null) return null
  const [, month, day, hours, minutes, seconds, year] = match
  const monthIndex = MONTHS.indexOf(month as (typeof MONTHS)[number])
  if (monthIndex < 0) return null
  return Date.UTC(Number(year), monthIndex, Number(day), Number(hours), Number(minutes), Number(seconds)) / 1000
}

/**
 * The process's start time as `epoch:<seconds>`. `ps` runs with `LC_ALL=C` and `TZ=UTC`, so two
 * processes with different locales or time zones record the same value for the same process.
 */
export function processStartTime(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("ps", ["-o", "lstart=", "-p", String(pid)], { env: { ...process.env, LC_ALL: "C", LANG: "C", TZ: "UTC" }, windowsHide: true, timeout: 5_000 }, (error, stdout) => {
      const seconds = error === null ? parseLstart(stdout) : null
      resolve(seconds === null ? null : `${EPOCH_PREFIX}${seconds}`)
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
 * applies, so a suspended or unreadable claimant is never reconciled behind its back. So does a
 * start time recorded by a pre-release build (the raw `ps` string in that process's locale and
 * time zone): it cannot be compared reliably, and a false "dead" would admit its rows twice.
 */
export async function isClaimantDead(identity: ProcessIdentity): Promise<boolean> {
  if (!pidExists(identity.pid)) return true
  if (identity.process_start_time === null || !identity.process_start_time.startsWith(EPOCH_PREFIX)) return false
  const current = await processStartTime(identity.pid)
  return current !== null && current !== identity.process_start_time
}

export function sameProcess(left: ProcessIdentity, right: ProcessIdentity): boolean {
  return left.pid === right.pid && left.process_start_time === right.process_start_time && left.instance_id === right.instance_id
}
