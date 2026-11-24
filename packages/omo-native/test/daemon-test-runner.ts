import { type ChildProcess, spawn, spawnSync } from "node:child_process"

import { childTreeCpuSeconds } from "./process-tree-cpu"

// #11845: a starved-but-working child must not die at a wall-clock deadline. A cold daemon start on a
// CPU-starved shard container legitimately needs multiples of its quiet-box wall time, and the CLI spends
// its whole life blocked in spawnSync while the daemon tree does the work — so the only honest progress
// signal is CPU time of the child's whole descendant tree. Kill on CPU stall, bound the runaway in CPU time too
// (#14676: a 120 s wall-clock runaway cap killed a `host ensure` still making progress at load 10-29), and let
// bun's test timeout sit above both as an outer bound only.
const STALL_KILL_MS = 10_000
// A runaway is a tree that keeps burning CPU without finishing, so it is capped in tree CPU seconds, which a loaded
// host does not inflate the way it inflates wall time. A quiet cold `host ensure` used 6.4-8.7 s of tree CPU on a
// 2-CPU Linux container and 11.5-17.1 s on an M-series Mac; under 4.2x and 8x oversubscription it used 8.4-10.2 s while
// its wall time grew to 25-78 s (#14676). The cap is about 3x the largest quiet measurement.
const RUNAWAY_CPU_CAP_S = 50
// Bun's per-test timeout for tests bounded this way, an outer bound only. The slowest healthy run measured was the
// observe-idle case at 16x CPU oversubscription, 274 s (#14792); 7 min clears it by 1.5x and is at most half of every
// CI job limit these files run under, so the other half covers checkout, install, builds and the earlier tests and a
// broken bound fails with the test's name instead of a cancelled job.
export const TREE_BOUNDED_TEST_TIMEOUT_MS = 7 * 60_000
const PROGRESS_SAMPLE_MS = 250
// Two scheduler quanta: less than this between samples is scheduling noise, not work.
const PROGRESS_EPSILON_S = 0.02
export class SpawnBudgetError extends Error {
  override name = "SpawnBudgetError"
}

export type TreeBound =
  | { readonly kind: "stalled"; readonly stalledForS: number; readonly cpuS: number }
  | { readonly kind: "runaway"; readonly cpuS: number }
  | { readonly kind: "unmeasurable"; readonly forS: number }

export function describeTreeBound(bound: TreeBound, cpuCapS = RUNAWAY_CPU_CAP_S): string {
  switch (bound.kind) {
    case "stalled":
      return `made no CPU progress for ${bound.stalledForS}s (tree cpu ${bound.cpuS.toFixed(2)}s): stalled, not slow`
    case "runaway":
      return `burned ${bound.cpuS.toFixed(2)}s of tree CPU without finishing, over the ${cpuCapS}s runaway CPU cap`
    case "unmeasurable":
      return `could not read its process tree's CPU for ${bound.forS}s, so neither bound could be checked`
  }
}

// Samples the CPU time of the tree rooted at pid and calls onBound once, when the tree stops advancing for stallMs
// or passes cpuCapS. Neither bound reads the wall clock as a budget, so host load cannot trip them. A sampler that
// cannot read the tree for stallMs disables both bounds, so that is reported as its own bound. `progressed` lets a
// caller count another sign of work (a build's output changing) as progress too. Returns stop().
export function watchTreeProgress(
  pid: number,
  onBound: (bound: TreeBound) => void,
  {
    stallMs = STALL_KILL_MS,
    cpuCapS = RUNAWAY_CPU_CAP_S,
    sample = childTreeCpuSeconds,
    progressed = () => false,
  }: { stallMs?: number; cpuCapS?: number; sample?: (pid: number) => number; progressed?: () => boolean } = {},
): () => void {
  let lastCpu = -1
  let lastAdvance = Date.now()
  let lastValidSample = Date.now()
  const sampler = setInterval(() => {
    const cpu = sample(pid)
    if (cpu < 0) {
      if (Date.now() - lastValidSample >= stallMs) {
        clearInterval(sampler)
        onBound({ kind: "unmeasurable", forS: Math.round((Date.now() - lastValidSample) / 1000) })
      }
      return
    }
    lastValidSample = Date.now()
    if (cpu > cpuCapS) {
      clearInterval(sampler)
      onBound({ kind: "runaway", cpuS: cpu })
    } else if (cpu >= lastCpu + PROGRESS_EPSILON_S || progressed()) {
      lastCpu = cpu
      lastAdvance = Date.now()
    } else if (cpu < lastCpu) {
      // A descendant exited and its CPU left the sum (the ps reading counts live processes only): this is a
      // new baseline, not progress, and the tree must still advance from it.
      lastCpu = cpu
    } else if (Date.now() - lastAdvance >= stallMs) {
      clearInterval(sampler)
      onBound({ kind: "stalled", stalledForS: Math.round((Date.now() - lastAdvance) / 1000), cpuS: cpu })
    }
  }, PROGRESS_SAMPLE_MS)
  return () => clearInterval(sampler)
}

// Every signal these tests send goes through this check first. A pid of 0 (or a negative one) addresses a whole
// process group, and 1 is init, so a bad value parsed from a child's output could kill this test runner's own group
// or the box: only a positive integer that is neither init, this process nor this process's group is accepted. The
// group is looked up on first use (never at import: the Windows suite imports this file and has no ps), and when it
// cannot be read every target is refused.
let ownProcessGroup: number | undefined
function ownPgid(): number {
  if (ownProcessGroup !== undefined) return ownProcessGroup
  if (process.platform === "win32") throw new Error("process groups are not signalled on win32")
  const lookup = spawnSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8" })
  const pgid = Number(lookup.stdout?.trim())
  if (lookup.status !== 0 || lookup.error !== undefined || !Number.isSafeInteger(pgid) || pgid <= 1) {
    throw new Error(`cannot read this process's group (ps status ${lookup.status}): refusing every signal target`)
  }
  ownProcessGroup = pgid
  return pgid
}

export function signalTarget(pid: unknown, what: string): number {
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid || pid === ownPgid()) {
    throw new Error(`refusing to signal ${what}: ${String(pid)} is not a separate process`)
  }
  return pid
}

// Each child leads its own process group, so a tripped bound kills every process it started, not only itself. A
// daemon the child detaches on purpose (host ensure's shard) leaves the group and stays with the harness cleanup.
export function killGroup(child: ChildProcess): void {
  if (child.pid === undefined) return
  try {
    process.kill(-signalTarget(child.pid, "the bounded child's process group"), "SIGKILL")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
  }
}

// The leader's close does not mean its grandchildren are gone: SIGKILL to the group is delivered at once, but each
// member exits (and is reaped by init) on its own schedule. Wait, bounded, until no live member is left.
const GROUP_EXIT_DEADLINE_MS = 10_000
function liveGroupMembers(pgid: number): number {
  const listed = spawnSync("ps", ["-axo", "pgid=,stat="], { encoding: "utf8" })
  // An empty listing from a failed ps would read as "no members left": fail instead of passing the check.
  if (listed.status !== 0 || listed.error !== undefined) {
    throw new Error(
      `cannot list process group ${pgid} (ps status ${listed.status}): ${String(listed.error ?? listed.stderr)}`,
    )
  }
  return listed.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([group, stat]) => Number(group) === pgid && !stat?.startsWith("Z")).length
}
function awaitGroupGone(pgid: number | undefined): void {
  if (pgid === undefined) return
  const deadline = Date.now() + GROUP_EXIT_DEADLINE_MS
  while (liveGroupMembers(pgid) > 0) {
    if (Date.now() > deadline)
      throw new Error(`process group ${pgid} still has live members ${GROUP_EXIT_DEADLINE_MS}ms after SIGKILL`)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
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
      // A tripped bound must be able to kill the child's group, so confirm that before starting anything.
      try {
        ownPgid()
      } catch (error) {
        reject(error)
        return
      }
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
                    try {
                      awaitGroupGone(child.pid)
                    } catch (error) {
                      reject(error)
                      return
                    }
                    reject(
                      new SpawnBudgetError(
                        `${command} ${args.join(" ")} ${describeTreeBound(bound, options.cpuCapS)}; killed process group ${child.pid}\nstdout: ${stdout}\nstderr: ${stderr}`,
                      ),
                    )
                  })
                  try {
                    killGroup(child)
                  } catch (error) {
                    // The group could not be signalled: end at least the child itself, then fail through run().
                    child.removeAllListeners("close")
                    child.kill("SIGKILL")
                    runningChildren.delete(child)
                    reject(error)
                  }
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
