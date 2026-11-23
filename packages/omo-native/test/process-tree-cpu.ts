import { readdirSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

type ProcessTable = { readonly ppidOf: Map<number, number>; readonly cpuOf: Map<number, number> }

function treeCpuSeconds(rootPid: number, { ppidOf, cpuOf }: ProcessTable): number {
  let total = 0
  const walk = (pid: number): void => {
    const cpu = cpuOf.get(pid)
    if (cpu === undefined) return
    total += cpu
    for (const [childPid, parentPid] of ppidOf) if (parentPid === pid) walk(childPid)
  }
  walk(rootPid)
  return total
}

// Linux: sum utime+stime+cutime+cstime over the /proc subtree rooted at the child. The CLI's own utime
// stays flat while it blocks on the daemon, so sampling the tree is what separates slow from stalled.
// macOS: ps gives the same graph once per sample. CLK_TCK is 100 on every host we run on.
// -1 means the tree could not be read at all (Windows has neither); watchTreeProgress reports that as its own bound.
export function childTreeCpuSeconds(rootPid: number): number {
  if (process.platform === "linux") {
    try {
      const ppidOf = new Map<number, number>()
      const cpuOf = new Map<number, number>()
      for (const entry of readdirSync("/proc")) {
        if (!/^\d+$/.test(entry)) continue
        let stat: string
        try {
          stat = readFileSync(`/proc/${entry}/stat`, "utf8")
        } catch {
          continue
        }
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
        ppidOf.set(Number(entry), Number(fields[1]))
        cpuOf.set(
          Number(entry),
          (Number(fields[11]) + Number(fields[12]) + Number(fields[13]) + Number(fields[14])) / 100,
        )
      }
      return treeCpuSeconds(rootPid, { ppidOf, cpuOf })
    } catch {
      return -1
    }
  }
  const listing = spawnSync("ps", ["-axo", "pid=,ppid=,cputime="], { encoding: "utf8" })
  if (listing.status !== 0) return -1
  const ppidOf = new Map<number, number>()
  const cpuOf = new Map<number, number>()
  for (const line of listing.stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
    if (!match) continue
    const parts = match[3].split(":")
    let seconds = 0
    for (const part of parts) {
      const [days, rest] = part.split("-")
      if (rest !== undefined) seconds += Number.parseInt(days, 10) * 86_400
      seconds = seconds * 60 + Number.parseFloat(rest ?? days)
    }
    ppidOf.set(Number(match[1]), Number(match[2]))
    cpuOf.set(Number(match[1]), seconds)
  }
  return treeCpuSeconds(rootPid, { ppidOf, cpuOf })
}
