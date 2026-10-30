import { expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeTree } from "../../../../test-support/remove-tree"
import { GitCommandError } from "../git/command"
import { startConcurrentMerges } from "./merge-fixture"

const repoRoot = join(import.meta.dir, "../../../..")
const fixture = "./packages/isolation-core/src/merge/abandoned-concurrent-merge.fixture.ts"

test("a concurrent-merge test that ends early leaves no running merge and no unhandled error for the next test (#9846, #9678)", async () => {
  const run = Bun.spawn([process.execPath, "test", fixture], { cwd: repoRoot, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited])
  const output = stdout + stderr
  expect(output).toContain("(fail) abandoned:")
  expect(output).toContain("(pass) neighbor:")
  expect(output).toMatch(/^ 1 pass$/m)
  expect(output).toMatch(/^ 1 fail$/m)
  expect(output).not.toContain("Unhandled error")
  expect(output).not.toContain("temp entr")
  expect(exitCode).toBe(1)
})

test("a merge that fails before taking the lock rejects the scenario instead of waiting for a lock signal", async () => {
  const notARepo = await mkdtemp(join(tmpdir(), "isolation-core-not-a-repo-"))
  try {
    const merges = startConcurrentMerges("branch", { repoRoot: notARepo })
    const failure = await merges.ready.then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(GitCommandError)
  } finally {
    await removeTree(notARepo)
  }
})
