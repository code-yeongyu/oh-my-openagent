import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { createDaemonEngineHarness, waitForExit } from "./daemon-real-engine-support"
import {
  createDaemonTestRunner,
  describeTreeBound,
  signalTarget,
  SpawnBudgetError,
  TREE_BOUNDED_TEST_TIMEOUT_MS,
  type TreeBound,
  watchTreeProgress,
} from "./daemon-test-runner"

const { run, killChildren } = createDaemonTestRunner()
setDefaultTimeout(TREE_BOUNDED_TEST_TIMEOUT_MS)
const scratch: string[] = []
afterEach(() => {
  killChildren()
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// The blocked shape of `host ensure`: the CLI waits in spawnSync on a child that does the work, so the sampler must
// read the whole tree from outside, and a tripped bound must take the grandchild down with it. The grandchild writes
// its pid first, so a test can prove it started and is gone afterwards.
function blockedOn(grandchildBody: string): { args: string[]; pidFile: string } {
  const dir = mkdtempSync(join(tmpdir(), "omo-budget-"))
  scratch.push(dir)
  const pidFile = join(dir, "grandchild.pid")
  const grandchild = `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); ${grandchildBody}`
  return {
    args: ["-e", `require("node:child_process").spawnSync(process.execPath, ["-e", ${JSON.stringify(grandchild)}])`],
    pidFile,
  }
}

// A killed process may linger as a zombie until init reaps it; only a live (non-zombie) process counts.
function alive(pid: number): boolean {
  const stat = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim()
  return stat !== "" && !stat.startsWith("Z")
}

// Starts a detached node process (the engine's runtime in these tests, OMO_RUNTIME=node) through a launcher that exits
// once the process says it is running, so it is orphaned like the supervisor the engine leaves behind; reports its pid.
function startOrphan(env: NodeJS.ProcessEnv): number {
  const orphan = `process.stdout.write("ready\\n"); process.stdout.on("error", () => {}); setTimeout(() => {}, 120_000)`
  const launcher = `const c = require("node:child_process").spawn("node", ["-e", ${JSON.stringify(orphan)}], { detached: true, stdio: ["ignore", "pipe", "ignore"] }); c.stdout.once("data", () => { console.log(c.pid); process.exit(0) })`
  const launched = spawnSync("node", ["-e", launcher], { env, encoding: "utf8", timeout: 60_000 })
  if (launched.status !== 0)
    throw new Error(`orphan launcher failed: status ${launched.status} ${String(launched.error ?? "")}`)
  return signalTarget(Number(launched.stdout.trim()), "the orphan fixture")
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("expected the bounded child to be killed")
}

if (process.platform !== "win32") {
  describe("omo daemon real-engine read-only and observe contracts", () => {
    describe("omo daemon real-engine spawn budget progress semantics", () => {
      test("#given a child blocked on a sleeping grandchild #when its tree stops advancing #then it is killed as stalled and the grandchild is gone", async () => {
        const { args, pidFile } = blockedOn("setTimeout(() => {}, 600_000)")
        const started = Date.now()
        const error = await rejection(run("node", args, process.env, { stallMs: 1_500 }))
        expect(error).toBeInstanceOf(SpawnBudgetError)
        expect(String(error)).toContain("stalled, not slow")
        expect(Date.now() - started).toBeLessThan(20_000)
        expect(existsSync(pidFile)).toBe(true)
        expect(alive(Number(readFileSync(pidFile, "utf8")))).toBe(false)
      })

      test("#given a child that keeps making CPU progress #when the stall window keeps elapsing #then it still exits on its own", async () => {
        // Solid CPU for 4s: far past the stall window, far under the runaway cap. The old wall-clock
        // deadline (or a fixed 30s test budget on a starved runner) is what this child used to lose to.
        const result = await run("node", ["-e", "const t=Date.now()+4000;while(Date.now()<t){}"], process.env, {
          stallMs: 1_500,
        })
        expect(result.exitCode).toBe(0)
      })

      test("#given a child blocked on a spinning grandchild #when its tree passes the runaway CPU cap #then it is killed as a runaway and the grandchild is gone", async () => {
        // Never stalls, so only the CPU cap can end it, however loaded the host is.
        const { args, pidFile } = blockedOn("for (;;) {}")
        const error = await rejection(run("node", args, process.env, { cpuCapS: 2 }))
        expect(error).toBeInstanceOf(SpawnBudgetError)
        expect(String(error)).toContain("over the 2s runaway CPU cap")
        expect(existsSync(pidFile)).toBe(true)
        expect(alive(Number(readFileSync(pidFile, "utf8")))).toBe(false)
      })

      // host ensure detaches the shard supervisor into its own session before it answers; a bound that trips first
      // leaves a supervisor the harness never learned the pid of. Cleanup must still find it by its sandbox.
      test("#given a detached process started in a sandbox #when the harness cleans up #then it is killed although its pid was never recorded", () => {
        const harness = createDaemonEngineHarness()
        let orphan: number | undefined
        let cleaned = false
        try {
          const { env } = harness.sandbox()
          orphan = startOrphan(env)
          expect(alive(orphan)).toBe(true)
          cleaned = true
          harness.cleanup()
          expect(alive(orphan)).toBe(false)
        } finally {
          if (!cleaned) harness.cleanup()
          if (orphan !== undefined) {
            try {
              process.kill(orphan, "SIGKILL")
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
            }
          }
        }
      })
    })
  })
}

// A sampler that cannot read the tree (no ps, an unreadable /proc) disables both bounds; it must fail on its own instead
// of leaving the child to the outer test timeout.
test("#given a tree whose CPU cannot be read #when the stall window passes #then the watch reports it as unmeasurable", async () => {
  const bound = await new Promise<TreeBound>((resolveBound) => {
    watchTreeProgress(process.pid, resolveBound, { stallMs: 500, sample: () => -1 })
  })
  expect(bound.kind).toBe("unmeasurable")
  expect(describeTreeBound(bound)).toContain("could not read its process tree's CPU")
})

// A child that has exited but that nobody reaped (a container whose init does not reap promptly) is a zombie: signal 0
// still reaches it, yet the harness must treat it as gone instead of failing the teardown.
test("#given an exited child left unreaped on purpose #when the harness waits for it #then it counts as exited", async () => {
  if (process.platform === "win32") return
  // The shell starts a child, prints its pid, and execs into sleep, which never waits: the child stays a zombie.
  const parent = spawn("sh", ["-c", "true & echo $!; exec sleep 60"], { stdio: ["ignore", "pipe", "ignore"] })
  try {
    const zombie = signalTarget(
      Number(
        await new Promise<string>((resolveLine, rejectLine) => {
          parent.stdout.once("data", (chunk: Buffer) => resolveLine(chunk.toString().trim()))
          parent.once("error", rejectLine)
        }),
      ),
      "the zombie fixture",
    )
    expect(() => waitForExit(zombie)).not.toThrow()
  } finally {
    parent.kill("SIGKILL")
  }
})

// A pid read from a child's output can be empty (a launcher that timed out) and parse as 0, which addresses this test
// runner's own process group; init, this process and this process's group are refused too. No signal is sent here.
if (process.platform !== "win32") {
  test("#given a pid that is not a separate process #when it is checked as a signal target #then it is refused", () => {
    const lookup = spawnSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8" })
    expect(lookup.status).toBe(0)
    const ownGroup = Number(lookup.stdout.trim())
    expect(Number.isSafeInteger(ownGroup) && ownGroup > 1).toBe(true)
    for (const bad of [Number(""), Number("x"), -5, 1, 1.5, process.pid, ownGroup]) {
      expect(() => signalTarget(bad, "a fixture")).toThrow("refusing to signal a fixture")
    }
    expect(signalTarget(process.pid + 1_000_000, "a fixture")).toBe(process.pid + 1_000_000)
  })
}

// The test timeout is only an outer bound: it must end a broken bound with at most half of the job's limit spent, so
// the rest covers setup and the earlier tests of every CI job that runs these files. Read from the workflow, not copied.
test("#given the CI jobs that run the tree-bounded tests #when their limits are read #then the outer test timeout is at most half of each", () => {
  const workflow = Bun.YAML.parse(
    readFileSync(resolve(import.meta.dir, "../../../.github/workflows/ci.yml"), "utf8"),
  ) as {
    jobs: Record<string, { "timeout-minutes"?: number }>
  }
  for (const job of ["test-linux", "senpi-tests-linux"]) {
    const minutes = workflow.jobs[job]?.["timeout-minutes"]
    expect(typeof minutes).toBe("number")
    expect(TREE_BOUNDED_TEST_TIMEOUT_MS * 2).toBeLessThanOrEqual(Number(minutes) * 60_000)
  }
})
