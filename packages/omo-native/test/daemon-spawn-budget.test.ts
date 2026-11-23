import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"

import { createDaemonTestRunner, TREE_BOUNDED_TEST_TIMEOUT_MS, SpawnBudgetError } from "./daemon-test-runner"

const { run, killChildren } = createDaemonTestRunner()
setDefaultTimeout(TREE_BOUNDED_TEST_TIMEOUT_MS)
afterEach(killChildren)

if (process.platform !== "win32") {
  describe("omo daemon real-engine read-only and observe contracts", () => {
    describe("omo daemon real-engine spawn budget progress semantics", () => {
      test("#given a child that stalls with no CPU work #when it stops advancing #then it is killed as stalled, not slow", async () => {
        const started = Date.now()
        let rejection: unknown
        try {
          // Sleeps 60s: alive, but its tree burns no CPU after boot.
          await run("node", ["-e", "setTimeout(() => {}, 60000)"], process.env, { stallMs: 1_500 })
        } catch (error) {
          rejection = error
        }
        expect(rejection).toBeInstanceOf(SpawnBudgetError)
        const elapsed = Date.now() - started
        expect(elapsed).toBeLessThan(20_000)
        expect(String(rejection)).toContain("stalled, not slow")
      })

      test("#given a child that keeps making CPU progress #when the stall window keeps elapsing #then it still exits on its own", async () => {
        // Solid CPU for 4s: far past the stall window, far under the runaway cap. The old wall-clock
        // deadline (or a fixed 30s test budget on a starved runner) is what this child used to lose to.
        const result = await run("node", ["-e", "const t=Date.now()+4000;while(Date.now()<t){}"], process.env, {
          stallMs: 1_500,
        })
        expect(result.exitCode).toBe(0)
      })

      test("#given a child that keeps burning CPU #when its tree passes the runaway CPU cap #then it is killed as a runaway", async () => {
        let rejection: unknown
        try {
          // Spins forever: never stalls, so only the CPU cap can end it, however loaded the host is.
          await run("node", ["-e", "for(;;){}"], process.env, { cpuCapS: 2 })
        } catch (error) {
          rejection = error
        }
        expect(rejection).toBeInstanceOf(SpawnBudgetError)
        expect(String(rejection)).toContain("over the 2s runaway CPU cap")
      })
    })
  })
}
