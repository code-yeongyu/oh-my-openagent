// The teardown watchdog: the process that cleans up when this one cannot.
//
// It holds one pipe - this process's stdin. A parent that exits for ANY reason, including a SIGKILL
// that runs no handler, closes the write end; the watchdog then kills the browser's process group
// and removes the profile. It ignores SIGINT and SIGTERM so a Ctrl-C that fells the whole foreground
// group still leaves someone alive to clean up.
//
// Two details that are not decoration:
// - A leaked copy of the pipe's write end in some other child would hold stdin open forever, so the
//   watchdog also notices its parent being replaced. That check survives a leaked descriptor.
// - The profile is deleted only once nothing in the browser's group can still write to it.

import { spawn } from "node:child_process"

/** Runs in its own interpreter, so it is source rather than a function. */
export const WATCHDOG_SOURCE = `
const fs = require("node:fs")
const pid = Number(process.env.OMO_HUDDLE_WATCH_PID)
const dir = process.env.OMO_HUDDLE_WATCH_DIR ?? ""
const parent = Number(process.env.OMO_HUDDLE_WATCH_PPID)
let done = false
const groupGone = () => { try { process.kill(-pid, 0); return false } catch { return true } }
const remove = (deadline) => {
  if (!groupGone() && Date.now() < deadline) { setTimeout(() => remove(deadline), 50); return }
  if (dir.length > 0) { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }) } catch {} }
  process.exit(0)
}
const cleanup = () => {
  if (done) return
  done = true
  if (Number.isInteger(pid) && pid > 1) { try { process.kill(-pid, "SIGKILL") } catch {} }
  remove(Date.now() + 2000)
}
process.on("SIGINT", () => {})
process.on("SIGTERM", () => {})
process.stdin.on("end", cleanup)
process.stdin.on("close", cleanup)
process.stdin.on("error", cleanup)
process.stdin.resume()
if (Number.isInteger(parent) && parent > 0) setInterval(() => { if (process.ppid !== parent) cleanup() }, 1000)
`

export type Watchdog = { readonly pid: number | undefined; release(): void }

/**
 * Start the watchdog for a browser process group and its profile.
 *
 * `release()` closes the pipe, which is exactly what a crash does - so the ordinary path and the
 * crash path run the same cleanup, and running it twice is harmless.
 */
export function spawnWatchdog(input: { readonly pid: number; readonly dir: string; readonly execPath?: string }): Watchdog {
  const child = spawn(input.execPath ?? process.execPath, ["-e", WATCHDOG_SOURCE], {
    stdio: ["pipe", "ignore", "ignore"],
    detached: true,
    env: { ...process.env, OMO_HUDDLE_WATCH_PID: String(input.pid), OMO_HUDDLE_WATCH_DIR: input.dir, OMO_HUDDLE_WATCH_PPID: String(process.pid) },
  })
  child.unref()
  let released = false
  return {
    pid: child.pid,
    release() {
      if (released) return
      released = true
      child.stdin?.end()
    },
  }
}
