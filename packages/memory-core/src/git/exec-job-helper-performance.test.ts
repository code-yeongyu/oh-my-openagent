import { afterEach, describe, expect, test } from "bun:test"

import { removeTree } from "../../../../test-support/remove-tree"
import { createNodeGitExec, type GitExec } from "./exec"
import { identityRepo, jobHelperPath, requireJobHelperWhenDemanded, runsJobHelperRows } from "./job-helper-fixtures.test-support"

requireJobHelperWhenDemanded()

// Row T15 (design v4.2 section 17) is a report, never a timing assertion: p50/p95 of 200 `git rev-parse HEAD` calls
// with and without the helper, and the per-command cost the owner reads against the 15 ms p50 target.
const ITERATIONS = 200
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? Number.NaN
}

async function sample(exec: GitExec, cwd: string): Promise<number[]> {
  const elapsed: number[] = []
  for (let index = 0; index < ITERATIONS; index += 1) {
    const started = performance.now()
    const result = await exec.run(["rev-parse", "HEAD"], { cwd, timeoutMs: 30_000 })
    elapsed.push(performance.now() - started)
    expect(result.code).toBe(0)
  }
  return elapsed.sort((left, right) => left - right)
}

describe.skipIf(!runsJobHelperRows)("T15: per-command cost of the helper (design v4.2 section 17, report only)", () => {
  test("#given 200 rev-parse calls each way #when they run #then the latency report is printed", async () => {
    const { root, paths } = await identityRepo("job-helper-t15-", "t15-performance")
    roots.push(root)
    const plain = await sample(createNodeGitExec(), paths.repo)
    const helper = await sample(createNodeGitExec({ jobHelper: { path: jobHelperPath() } }), paths.repo)
    const report = {
      iterations: ITERATIONS,
      plainMs: { p50: percentile(plain, 0.5), p95: percentile(plain, 0.95) },
      helperMs: { p50: percentile(helper, 0.5), p95: percentile(helper, 0.95) },
      addedMs: { p50: percentile(helper, 0.5) - percentile(plain, 0.5), p95: percentile(helper, 0.95) - percentile(plain, 0.95) },
    }
    console.log(`[T15] ${JSON.stringify(report)}`)
    expect(helper).toHaveLength(ITERATIONS)
  }, 600_000)
})
