import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { rm } from "node:fs/promises"

import { KibitzerGateRunner } from "./kibitzer-runner"
import { callNudge, CANDIDATES, fixture, launchInput, nudgeOnce, roots, runnerOptions, scriptedSession } from "./kibitzer-runner.test-support"

const START = 1_800_000_000_000
let clock: ReturnType<typeof spyOn<typeof Date, "now">> | undefined

function fakeClock() {
  let now = START
  clock = spyOn(Date, "now").mockImplementation(() => now)
  return { at: (elapsedMs: number) => { now = START + elapsedMs } }
}

afterEach(async () => {
  clock?.mockRestore()
  clock = undefined
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("KibitzerGateRunner nudge cooldown", () => {
  test("#given two accepted outcomes #when another launch arrives in the rolling window #then it skips before creating a child and expires each acceptance separately", async () => {
    const { identityPaths } = await fixture()
    const time = fakeClock()
    const stub = scriptedSession(nudgeOnce)
    stub.resolve()
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))
    const input = launchInput()

    const first = await runner.launch(input)
    time.at(100_000)
    const second = await runner.launch(input)
    time.at(599_999)
    const third = await runner.launch(input)

    expect([first.status, second.status, third.status]).toEqual(["nudged", "nudged", "skipped"])
    expect(third).toEqual({ status: "skipped", cause: "cooldown", candidateCount: 1 })
    expect(stub.created).toBe(2)

    time.at(600_000)
    expect((await runner.launch(input)).status).toBe("nudged")
    expect(stub.created).toBe(3)
    time.at(600_001)
    expect(await runner.launch(input)).toMatchObject({ status: "skipped", cause: "cooldown" })
    time.at(700_000)
    expect((await runner.launch(input)).status).toBe("nudged")
    expect(stub.created).toBe(4)
  })

  test("#given sessions sharing one identity runner #when one exhausts its budget #then the other retains two accepts", async () => {
    const { identityPaths } = await fixture()
    fakeClock()
    const stub = scriptedSession(nudgeOnce)
    stub.resolve()
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))
    const first = launchInput({ sessionId: "first" })
    const second = launchInput({ sessionId: "second" })

    expect((await runner.launch(first)).status).toBe("nudged")
    expect((await runner.launch(second)).status).toBe("nudged")
    expect((await runner.launch(first)).status).toBe("nudged")
    expect(await runner.launch(first)).toMatchObject({ status: "skipped", cause: "cooldown" })
    expect((await runner.launch(second)).status).toBe("nudged")
    expect(await runner.launch(second)).toMatchObject({ status: "skipped", cause: "cooldown" })
    expect(stub.created).toBe(4)
  })

  test("#given skipped empty failed and compaction-dropped outcomes #when two later outcomes are accepted #then only those accepts consume budget", async () => {
    const { identityPaths } = await fixture()
    fakeClock()
    let emitNudge = false
    let failCreation = false
    const stub = scriptedSession(async (options) => { if (emitNudge) await nudgeOnce(options) })
    stub.resolve()
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, {
      createSession: async (options) => {
        if (failCreation) throw new Error("scripted session creation failure")
        return stub.createSession(options)
      },
    }))
    const input = launchInput()

    expect((await runner.launch({ ...input, candidates: [] })).status).toBe("skipped")
    expect((await runner.launch(input)).status).toBe("empty")
    failCreation = true
    expect((await runner.launch(input)).status).toBe("failed")
    failCreation = false
    emitNudge = true
    expect(await runner.launch({ ...input, compactionEpoch: 0, currentCompactionEpoch: () => 1 })).toMatchObject({ status: "dropped", cause: "compaction" })
    expect((await runner.launch(input)).status).toBe("nudged")
    expect((await runner.launch(input)).status).toBe("nudged")
    expect(await runner.launch(input)).toMatchObject({ status: "skipped", cause: "cooldown" })
    expect(stub.created).toBe(4)
  })

  test("#given a judge that finishes later than it launched #when the launch-time window expires #then its acceptance still counts", async () => {
    const { identityPaths } = await fixture()
    const time = fakeClock()
    let completions = 0
    const stub = scriptedSession(async (options) => {
      await nudgeOnce(options)
      time.at(++completions * 100_000)
    })
    stub.resolve()
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))
    const input = launchInput()

    expect((await runner.launch(input)).status).toBe("nudged")
    expect((await runner.launch(input)).status).toBe("nudged")
    time.at(600_000)
    expect(await runner.launch(input)).toMatchObject({ status: "skipped", cause: "cooldown" })
    expect(stub.created).toBe(2)
  })

  test("#given an active launch and later compaction #when the session reaches two accepts #then neither resets or overspends the budget but a new runner starts fresh", async () => {
    const { identityPaths } = await fixture()
    fakeClock()
    const stub = scriptedSession(nudgeOnce)
    stub.resolve()
    const options = runnerOptions(identityPaths, { createSession: stub.createSession })
    const runner = new KibitzerGateRunner(options)
    const input = launchInput()

    const pending = runner.launch(input)
    expect(await runner.launch(input)).toEqual({ status: "active" })
    expect((await pending).status).toBe("nudged")
    expect((await runner.launch(input)).status).toBe("nudged")
    expect(await runner.launch({ ...input, compactionEpoch: 1, currentCompactionEpoch: () => 1 })).toMatchObject({ status: "skipped", cause: "cooldown" })
    expect(stub.created).toBe(2)
    expect((await new KibitzerGateRunner(options).launch(input)).status).toBe("nudged")
  })

  test("#given two hints in each accepted outcome #when the same session launches again #then the budget counts outcomes rather than hint paths", async () => {
    const { identityPaths } = await fixture()
    fakeClock()
    const secondPath = "reference/rollout-incidents.md"
    const stub = scriptedSession(async (options) => {
      await nudgeOnce(options)
      const result = await callNudge(options, secondPath, "Pause rollouts during an incident.")
      if (result.isError) throw new Error(result.text)
    })
    stub.resolve()
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))
    const input = launchInput({ candidates: [...CANDIDATES, { path: secondPath, description: "Incidents", excerpt: "Pause rollouts", score: 1 }] })

    for (let index = 0; index < 2; index += 1) {
      const result = await runner.launch(input)
      expect(result.status).toBe("nudged")
      if (result.status === "nudged") expect(result.nudges).toHaveLength(2)
    }
    expect(await runner.launch(input)).toMatchObject({ status: "skipped", cause: "cooldown" })
    expect(stub.created).toBe(2)
  })
})
