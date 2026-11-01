import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

for (const scenario of ["close", "crash"]) {
  test.skipIf(process.platform !== "win32")(`#given an acknowledged live job descendant #when ${scenario} removes the last job handle #then the name-based death hypothesis is falsified`, async () => {
    // #given: the experiment owns only a process handle during the zero-job-handle
    // interval. Neither the observer nor the creator can keep the job name alive.
    const experiment = fileURLToPath(new URL("../concurrency/windows-job-name-experiment.test-support.ts", import.meta.url))

    // #when: exit 1 is this experiment's explicit rejection of the proposed oracle,
    // not a swallowed test failure. Setup/ABI/cleanup failures have no valid receipt.
    const child = Bun.spawn([process.execPath, experiment, scenario], {
      env: { ...process.env, BUN_BE_BUN: "1" },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])

    // #then
    expect(stderr).toBe("")
    expect(exitCode).toBe(1)
    expect(JSON.parse(stdout)).toEqual({
      scenario,
      hypothesis: "missing-job-name-proves-idle",
      verdict: "FALSIFIED",
      descendantAliveBeforeKill: true,
      descendantAliveAfterKill: true,
      observerJobHandles: 0,
      namePresentBeforeCreatorDeath: scenario === "crash",
      afterCreatorDeathError: 2,
    })
  }, 30_000)
}
