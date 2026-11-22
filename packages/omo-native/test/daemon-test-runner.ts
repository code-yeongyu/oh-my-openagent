import { readdirSync, readFileSync } from "node:fs"
import { type ChildProcess, spawn, spawnSync } from "node:child_process"

// #11845: a starved-but-working child must not die at a wall-clock deadline. A cold daemon start on a
// CPU-starved shard container legitimately needs multiples of its quiet-box wall time, and the CLI spends
// its whole life blocked in spawnSync while the daemon tree does the work — so the only honest progress
// signal is CPU time of the child's whole descendant tree. Kill on CPU stall, bound the runaway, and let
// bun's test timeout sit above both.
const STALL_KILL_MS = 10_000
export const RUNAWAY_CAP_MS = 120_000
const PROGRESS_SAMPLE_MS = 250
// Two scheduler quanta: less than this between samples is scheduling noise, not work.
const PROGRESS_EPSILON_S = 0.02
export class SpawnBudgetError extends Error {
  override name = "SpawnBudgetError"
}

// Linux: sum utime+stime+cutime+cstime over the /proc subtree rooted at the child. The CLI's own utime
// stays flat while it blocks on the daemon, so sampling the tree is what separates slow from stalled.
// macOS: ps gives the same graph once per sample. CLK_TCK is 100 on every host we run on.
function childTreeCpuSeconds(rootPid: number): number {
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
      let total = 0
      const walk = (pid: number): void => {
        const cpu = cpuOf.get(pid)
        if (cpu === undefined) return
        total += cpu
        for (const [childPid, parentPid] of ppidOf) if (parentPid === pid) walk(childPid)
      }
      walk(rootPid)
      return total
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

export function createDaemonTestRunner() {
  const runningChildren = new Set<ChildProcess>()

  // A cold `node` start on a loaded host can take longer than any fixed per-spawn budget (#9679), so each child
  // runs until it closes. The bounds are progress-shaped (#11845): a child whose descendant tree stops making
  // CPU progress for stallMs is killed as stalled; a child that keeps making progress is bounded only by the
  // runaway cap. Both rejections name the command and its output.
  function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv, options: { stallMs?: number } = {}) {
    const stallMs = options.stallMs ?? STALL_KILL_MS
    return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolvePromise, reject) => {
      const child = spawn(command, [...args], { env, stdio: ["ignore", "pipe", "pipe"] })
      runningChildren.add(child)
      let stdout = ""
      let stderr = ""
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        stdout += chunk
      })
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        stderr += chunk
      })
      let settled = false
      const settle = (finish: () => void): void => {
        if (settled) return
        settled = true
        clearInterval(sampler)
        clearTimeout(capTimer)
        finish()
      }
      const capTimer = setTimeout(() => {
        child.kill("SIGKILL")
        settle(() =>
          reject(
            new SpawnBudgetError(
              `${command} ${args.join(" ")} exceeded the ${RUNAWAY_CAP_MS}ms runaway cap while still making CPU progress\nstdout: ${stdout}\nstderr: ${stderr}`,
            ),
          ),
        )
      }, RUNAWAY_CAP_MS)
      let lastCpu = -1
      let lastAdvance = Date.now()
      const sampler = setInterval(() => {
        if (child.pid === undefined) return
        const cpu = childTreeCpuSeconds(child.pid)
        if (cpu < 0) return
        if (cpu >= lastCpu + PROGRESS_EPSILON_S) {
          lastCpu = cpu
          lastAdvance = Date.now()
          return
        }
        if (Date.now() - lastAdvance >= stallMs) {
          child.kill("SIGKILL")
          const stalledFor = Math.round((Date.now() - lastAdvance) / 1000)
          settle(() =>
            reject(
              new SpawnBudgetError(
                `${command} ${args.join(" ")} made no CPU progress for ${stalledFor}s (tree cpu ${cpu.toFixed(2)}s): stalled, not slow\nstdout: ${stdout}\nstderr: ${stderr}`,
              ),
            ),
          )
        }
      }, PROGRESS_SAMPLE_MS)
      child.on("error", (error) => {
        settle(() => {
          runningChildren.delete(child)
          reject(error)
        })
      })
      child.on("close", (code) => {
        settle(() => {
          runningChildren.delete(child)
          resolvePromise({ exitCode: code ?? 1, stdout, stderr })
        })
      })
    })
  }

  function killChildren(): void {
    for (const child of runningChildren) child.kill("SIGKILL")
    runningChildren.clear()
  }

  return { run, killChildren }
}
