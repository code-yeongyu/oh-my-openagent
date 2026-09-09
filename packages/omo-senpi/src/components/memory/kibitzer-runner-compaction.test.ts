import { afterEach, describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { KibitzerGateRunner } from "./kibitzer-runner"
import { CANDIDATE_PATH, fixture, launchInput, nudgeOnce, roots, runnerOptions, scriptedSession } from "./kibitzer-runner.test-support"
import { rmEfaultTolerant } from "./teardown.test-support"

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))) })

describe("KibitzerGateRunner", () => {
  test("#given a compaction accepted mid-flight #when the child finishes #then the stale nudges are discarded instead of written", async () => {
    // given: the child judged transcript T1; a compaction accepted while it ran rewrote that
    // transcript, so its verdict now advises a conversation that no longer exists.
    const { identityPaths } = await fixture()
    const stub = scriptedSession(nudgeOnce)
    const warnings: string[] = []
    let epoch = 7
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, {
      createSession: stub.createSession,
      logger: { info: () => undefined, warn: (message) => warnings.push(message), error: () => undefined },
    }))

    // when: the epoch advances while the child runs
    const pending = runner.launch(launchInput({
      compactionEpoch: epoch,
      currentCompactionEpoch: () => {
        epoch = 8
        return epoch
      },
    }))
    stub.resolve()
    const result = await pending

    // then
    expect(result.status).toBe("dropped")
    if (result.status === "dropped") expect(result.cause).toBe("compaction")
    expect(warnings).toEqual(["kibitzer gate nudges dropped after compaction"])
  })

  test("#given a compaction-epoch bump mid-flight #when the child finishes #then outcome.json records dropped compaction", async () => {
    const { identityPaths } = await fixture()
    const stub = scriptedSession(nudgeOnce)
    let epoch = 7
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))
    const pending = runner.launch(launchInput({
      compactionEpoch: epoch,
      currentCompactionEpoch: () => {
        epoch = 8
        return epoch
      },
    }))
    stub.resolve()
    const result = await pending
    // A dropped verdict still names the model that judged (the launch primary here: the scripted
    // session reports no provider/model), so the gate entry keeps its provenance.
    expect(result).toMatchObject({ status: "dropped", cause: "compaction", model: "omo-mock/mock-1" })
    const names = await readdir(join(identityPaths.recall, "runs"))
    expect(names).toHaveLength(1)
    const name = names[0]
    expect(name).toBeDefined()
    if (name === undefined) return
    const parsed: unknown = JSON.parse(await readFile(join(identityPaths.recall, "runs", name, "outcome.json"), "utf8"))
    expect(parsed).toMatchObject({ status: "dropped", cause: "compaction", nudged: [], model: "omo-mock/mock-1" })
  })

  test("#given an unchanged compaction epoch #when the child finishes #then the result is nudged and carries the validated list", async () => {
    // given
    const { identityPaths } = await fixture()
    const stub = scriptedSession(nudgeOnce)
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))

    // when
    const pending = runner.launch(launchInput({
      compactionEpoch: 3,
      currentCompactionEpoch: () => 3,
    }))
    stub.resolve()
    const result = await pending

    // then
    expect(result).toMatchObject({
      status: "nudged",
      nudges: [{ path: CANDIDATE_PATH, hint: "Drain nodes before a rollout." }],
    })
  })
})
