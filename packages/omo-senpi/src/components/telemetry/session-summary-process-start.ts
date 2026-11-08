import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

import { parseLstart } from "../thread/gateway/process-identity"

/**
 * When `pid`'s process started, as an opaque token compared only against tokens this same probe produced on
 * this machine, or null when it cannot be read. Synchronous because the owner registry is.
 *
 * Linux: field 22 of `/proc/<pid>/stat` (clock ticks since boot), a file read with no subprocess.
 * macOS and other Unix: `ps -o lstart=` in the C locale at UTC, the source `thread/gateway/process-identity.ts`
 * already uses. Windows: null. Its only source is the process creation time behind a PowerShell or WMI call,
 * far too slow to run on every liveness check, so the registry falls back to the entry's heartbeat there.
 */
export function readProcessStartTime(pid: number, platform: typeof process.platform = process.platform): string | null {
  if (platform === "win32") return null
  return platform === "linux" ? procStatStartTime(pid) : psStartTime(pid)
}

function procStatStartTime(pid: number): string | null {
  let stat: string
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8")
  } catch {
    return null
  }
  // The command name (field 2) is parenthesized and may hold spaces or parens: fields resume after the last ")".
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
  const ticks = fields[19]
  return ticks !== undefined && /^\d+$/.test(ticks) ? `proc:${ticks}` : null
}

function psStartTime(pid: number): string | null {
  try {
    const stdout = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C", LANG: "C", TZ: "UTC" },
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
      windowsHide: true,
    })
    const seconds = parseLstart(stdout)
    return seconds === null ? null : `epoch:${seconds}`
  } catch {
    return null
  }
}
