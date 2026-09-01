import { afterEach, describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { rmEfaultTolerant } from "../teardown.test-support"

import { createRunnerHarness, type RunnerHarness } from "./runner.test-support"

const harnesses: RunnerHarness[] = []
afterEach(async () => Promise.all(harnesses.splice(0).map((item) => rmEfaultTolerant(item.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))))

describe("live reflection run finalization", () => {
  test("#given a successful supervised run #when the parent finalizer completes #then final is published after integration and the merge carries its run receipt", async () => {
    // given
    const item = await createRunnerHarness({ childMode: "commit" })
    harnesses.push(item)

    // when
    const result = await item.runner.launch(item.run)
    const final = JSON.parse(await readFile(join(item.identity.paths.reflection, "runs", item.run.runId, "final.json"), "utf8"))
    const process = Bun.spawn(["git", "log", "-1", "--format=%B"], { cwd: item.identity.paths.repo, stdout: "pipe" })
    const message = await new Response(process.stdout).text()
    const exit = await process.exited

    // then
    expect(result.outcome).toBe("merged")
    expect(final).toMatchObject({ version: 1, runId: item.run.runId, outcome: "merged" })
    expect(exit).toBe(0)
    expect(message).toContain(`Omo-Run: ${item.run.runId}`)
  }, 30_000)
})
