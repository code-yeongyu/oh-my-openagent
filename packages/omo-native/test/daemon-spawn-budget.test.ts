import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { createDaemonTestRunner, TREE_BOUNDED_TEST_TIMEOUT_MS, SpawnBudgetError } from "./daemon-test-runner"

const { run, killChildren } = createDaemonTestRunner()
setDefaultTimeout(TREE_BOUNDED_TEST_TIMEOUT_MS)
afterEach(killChildren)

// The blocked shape of `host ensure`: the CLI waits in spawnSync on a child that does the work, so the sampler must
// read the whole tree from outside, and a tripped bound must take the grandchild down with it.
const SYNC_SLEEP = `require("node:child_process").spawnSync("sleep", ["600"])`
const SYNC_SPIN = `require("node:child_process").spawnSync(process.execPath, ["-e", "for(;;){}"])`

function groupMembers(pgid: number): number {
  const listing = spawnSync("ps", ["-axo", "pgid="], { encoding: "utf8" }).stdout
  return listing.split("\n").filter((line) => Number(line.trim()) === pgid).length
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("expected the bounded child to be killed")
}

function killedGroup(error: unknown): number {
  return Number(String(error).match(/killed process group (\d+)/)?.[1])
}

if (process.platform !== "win32") {
  describe("omo daemon real-engine read-only and observe contracts", () => {
    describe("omo daemon real-engine spawn budget progress semantics", () => {
      test("#given a child blocked on a sleeping grandchild #when its tree stops advancing #then it is killed as stalled and its process group is gone", async () => {
        const started = Date.now()
        const error = await rejection(run("node", ["-e", SYNC_SLEEP], process.env, { stallMs: 1_500 }))
        expect(error).toBeInstanceOf(SpawnBudgetError)
        expect(String(error)).toContain("stalled, not slow")
        expect(Date.now() - started).toBeLessThan(20_000)
        expect(groupMembers(killedGroup(error))).toBe(0)
      })

      test("#given a child that keeps making CPU progress #when the stall window keeps elapsing #then it still exits on its own", async () => {
        // Solid CPU for 4s: far past the stall window, far under the runaway cap. The old wall-clock
        // deadline (or a fixed 30s test budget on a starved runner) is what this child used to lose to.
        const result = await run("node", ["-e", "const t=Date.now()+4000;while(Date.now()<t){}"], process.env, {
          stallMs: 1_500,
        })
        expect(result.exitCode).toBe(0)
      })

      test("#given a child blocked on a spinning grandchild #when its tree passes the runaway CPU cap #then it is killed as a runaway and its process group is gone", async () => {
        // Never stalls, so only the CPU cap can end it, however loaded the host is.
        const error = await rejection(run("node", ["-e", SYNC_SPIN], process.env, { cpuCapS: 2 }))
        expect(error).toBeInstanceOf(SpawnBudgetError)
        expect(String(error)).toContain("over the 2s runaway CPU cap")
        expect(groupMembers(killedGroup(error))).toBe(0)
      })
    })
  })
}

// The test timeout is only an outer bound, so it must end a broken bound inside the CI job that runs these files,
// where the failure names the test, instead of the job's own timeout cancelling it. Read from the workflow, not copied.
test("#given the Linux test job's time limit #when the tree-bounded test timeout is compared #then it fires inside the job", () => {
  const workflow = Bun.YAML.parse(
    readFileSync(resolve(import.meta.dir, "../../../.github/workflows/ci.yml"), "utf8"),
  ) as {
    jobs: Record<string, { "timeout-minutes"?: number }>
  }
  const jobMinutes = workflow.jobs["test-linux"]?.["timeout-minutes"]
  expect(typeof jobMinutes).toBe("number")
  expect(TREE_BOUNDED_TEST_TIMEOUT_MS).toBeLessThan(Number(jobMinutes) * 60_000)
})
