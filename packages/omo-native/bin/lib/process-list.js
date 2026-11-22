import { spawnSync } from "node:child_process"

/**
 * Reads the live process table. `ps` is the portable answer on macOS and Linux alike, and reading
 * it can never be a reason for diagnostics to fail, so an unavailable or unparsable listing is an
 * empty list.
 */
export function listProcesses() {
  if (process.platform === "win32") return []
  // -ww: an unlimited width, so `args` is never cut at the terminal width (BSD/macOS `ps` truncates).
  const listed = spawnSync("ps", ["-ww", "-axo", "pid=,ppid=,etime=,tty=,args="], { encoding: "utf8" })
  if (listed.status !== 0 || typeof listed.stdout !== "string") return []
  const entries = []
  for (const line of listed.stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line)
    if (!match) continue
    entries.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      elapsed: match[3],
      tty: match[4],
      command: match[5],
    })
  }
  return entries
}
