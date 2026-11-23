import { readdirSync, readFileSync } from "node:fs"
import { type ChildProcess, spawn, spawnSync } from "node:child_process"

// #11845: a starved-but-working child must not die at a wall-clock deadline. A cold daemon start on a
// CPU-starved shard container legitimately needs multiples of its quiet-box wall time, and the CLI spends
// its whole life blocked in spawnSync while the daemon tree does the work — so the only honest progress
// signal is CPU time of the child's whole descendant tree. Kill on CPU stall, bound the runaway in CPU time too
// (#14676: a 120 s wall-clock runaway cap killed a `host ensure` still making progress at load 10-29), and let
// bun's test timeout sit above both as an outer bound only.
export const STALL_KILL_MS = 10_000
// A runaway is a tree that keeps burning CPU without finishing, so it is capped in tree CPU seconds, which a loaded
// host does not inflate the way it inflates wall time. A quiet cold `host ensure` used 6.4-8.7 s of tree CPU on a
// 2-CPU Linux container and 11.5-17.1 s on an M-series Mac; under 4.2x and 8x oversubscription it used 8.4-10.2 s while
// its wall time grew to 25-78 s (#14676). The cap is about 3x the largest quiet measurement.
export const RUNAWAY_CPU_CAP_S = 50
// Bun's per-test timeout for tests bounded this way: the test-linux job limit (15 min) minus a minute, so a broken
// bound still fails inside the job with the test's name instead of as a cancelled job.
export const TREE_BOUNDED_TEST_TIMEOUT_MS = 14 * 60_000
const PROGRESS_SAMPLE_MS = 250
// Two scheduler quanta: less than this between samples is scheduling noise, not work.
const PROGRESS_EPSILON_S = 0.02
export class SpawnBudgetError extends Error {
  override name = "SpawnBudgetError"
}

export type TreeBound =
  | { readonly kind: "stalled"; readonly stalledForS: number; readonly cpuS: number }
  | { readonly kind: "runaway"; readonly cpuS: number }

export function describeTreeBound(bound: TreeBound, cpuCapS = RUNAWAY_CPU_CAP_S): string {
  switch (bound.kind) {
    case "stalled":
      return `made no CPU progress for ${bound.stalledForS}s (tree cpu ${bound.cpuS.toFixed(2)}s): stalled, not slow`
    case "runaway":
      return `burned ${bound.cpuS.toFixed(2)}s of tree CPU without finishing, over the ${cpuCapS}s runaway CPU cap`
  }
}

// Samples the CPU time of the tree rooted at pid and calls onBound once, when the tree stops advancing for stallMs
// or passes cpuCapS. Neither bound reads the wall clock as a budget, so host load cannot trip them. Returns stop().
export function watchTreeProgress(
  pid: number,
  onBound: (bound: TreeBound) => void,
  { stallMs = STALL_KILL_MS, cpuCapS = RUNAWAY_CPU_CAP_S }: { stallMs?: number; cpuCapS?: number } = {},
): () => void {
  let lastCpu = -1
  let lastAdvance = Date.now()
  const sampler = setInterval(() => {
    const cpu = childTreeCpuSeconds(pid)
    if (cpu < 0) return
    if (cpu > cpuCapS) {
      clearInterval(sampler)
      onBound({ kind: "runaway", cpuS: cpu })
    } else if (cpu >= lastCpu + PROGRESS_EPSILON_S) {
      lastCpu = cpu
      lastAdvance = Date.now()
    } else if (Date.now() - lastAdvance >= stallMs) {
      clearInterval(sampler)
      onBound({ kind: "stalled", stalledForS: Math.round((Date.now() - lastAdvance) / 1000), cpuS: cpu })
    }
  }, PROGRESS_SAMPLE_MS)
  return () => clearInterval(sampler)
}

// Linux: sum utime+stime+cutime+cstime over the /proc subtree rooted at the child. The CLI's own utime
// stays flat while it blocks on the daemon, so sampling the tree is what separates slow from stalled.
// macOS: ps gives the same graph once per sample. CLK_TCK is 100 on every host we run on.
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

// Each child leads its own process group, so a tripped bound kills every process it started, not only itself. A
// daemon the child detaches on purpose (host ensure's shard) leaves the group and stays with the harness cleanup.
function killGroup(child: ChildProcess): void {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, "SIGKILL")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
  }
}

export function createDaemonTestRunner() {
  const runningChildren = new Set<ChildProcess>()

  // A cold `node` start on a loaded host can take longer than any fixed per-spawn budget (#9679), so each child
  // runs until it closes. The bounds are progress-shaped (#11845): a child whose descendant tree stops making
  // CPU progress for stallMs is killed as stalled; a child that keeps making progress is bounded only by the
  // runaway CPU cap. Both rejections name the command and its output.
  function run(
    command: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    options: { stallMs?: number; cpuCapS?: number } = {},
  ) {
    return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolvePromise, reject) => {
      // The sampler runs in this process's event loop while the child runs asynchronously beside it, so it keeps
      // sampling however the child blocks; spawnSync here would starve it.
      const child = spawn(command, [...args], { env, stdio: ["ignore", "pipe", "pipe"], detached: true })
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
        stopWatch()
        finish()
      }
      const stopWatch =
        child.pid === undefined
          ? () => {}
          : watchTreeProgress(
              child.pid,
              (bound) => {
                settle(() => {
                  // Reject once the group leader is reaped, so the caller never sees the group still running.
                  child.once("close", () => {
                    runningChildren.delete(child)
                    reject(
                      new SpawnBudgetError(
                        `${command} ${args.join(" ")} ${describeTreeBound(bound, options.cpuCapS)}; killed process group ${child.pid}\nstdout: ${stdout}\nstderr: ${stderr}`,
                      ),
                    )
                  })
                  killGroup(child)
                })
              },
              options,
            )
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
    for (const child of runningChildren) killGroup(child)
    runningChildren.clear()
  }

  return { run, killChildren }
}
