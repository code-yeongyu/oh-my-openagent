import { afterEach, describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import type { MemoryIdentity } from "../identity"
import { ReflectionReservationStore, type ReservationResult } from "../reflection/reservation"
import type { ReservedRun } from "../reflection/machine"
import {
  assertLinearCommits,
  createConcurrencyKit,
  type ChildHarness,
} from "./two-process-kit.test-support"

const writerChildPath = fileURLToPath(new URL("./writer-child.ts", import.meta.url))
const reflectionChildPath = fileURLToPath(new URL("./reflection-child.ts", import.meta.url))

const kit = createConcurrencyKit()
afterEach(kit.cleanup)

function spawnWriter(
  fixtureValue: Awaited<ReturnType<typeof kit.fixture>>,
  mode: "normal" | "kill-holder" | "recovery",
  writerId: string,
): ChildHarness {
  return kit.harnessFor(writerChildPath, [
    mode,
    fixtureValue.identity.paths.repo,
    fixtureValue.identity.paths.locks,
    writerId,
    "10",
    fixtureValue.contentionPath,
  ])
}

async function assertTwentyLinearCommits(identity: MemoryIdentity): Promise<void> {
  await assertLinearCommits(identity, 20)
}

describe("one memory identity across real Bun processes", () => {
  test("#given two synchronized tool writers #when each makes ten writes #then twenty linear commits land with observed lock contention", async () => {
    // #given
    const shared = await kit.fixture()
    const first = spawnWriter(shared, "normal", "first")
    const second = spawnWriter(shared, "normal", "second")
    await Promise.all([first.waitForLine("ready"), second.waitForLine("ready")])
    const holding = Promise.race([first.waitForLine("holding"), second.waitForLine("holding")])
    const contended = Promise.race([first.waitForLine("contended"), second.waitForLine("contended")])

    // #when
    first.send("go")
    second.send("go")
    await Promise.all([holding, contended])
    first.send("release-first")
    second.send("release-first")
    await Promise.all([first.waitForPrefix("done:"), second.waitForPrefix("done:")])
    await Promise.all([kit.expectSuccessful(first), kit.expectSuccessful(second)])

    // #then
    const contentionAttempts = (await readFile(shared.contentionPath, "utf8")).split("\n").filter(Boolean)
    expect(contentionAttempts.length).toBeGreaterThanOrEqual(1)
    await assertTwentyLinearCommits(shared.identity)
  }, 30_000)

  test("#given two synchronized reflection reservers #when they race one identity #then one is active, one is pending, and completion promotes pending", async () => {
    // #given
    const shared = await kit.fixture()
    const first = kit.harnessFor(reflectionChildPath, [shared.root, shared.identity.id, "reflection-first"])
    const second = kit.harnessFor(reflectionChildPath, [shared.root, shared.identity.id, "reflection-second"])
    await Promise.all([first.waitForLine("ready"), second.waitForLine("ready")])
    const firstResultLine = first.waitForPrefix("result:")
    const secondResultLine = second.waitForPrefix("result:")

    // #when
    first.send("go")
    second.send("go")
    const resultLines = await Promise.all([firstResultLine, secondResultLine])
    await Promise.all([kit.expectSuccessful(first), kit.expectSuccessful(second)])
    const results = resultLines.map((line) => JSON.parse(line.slice("result:".length)) as ReservationResult)

    // #then
    expect(results.map((result) => result.status).sort()).toEqual(["active", "pending"])
    const activeRecord = JSON.parse(await readFile(join(shared.identity.paths.reflection, "active.lock"), "utf8")) as ReservedRun
    const pendingRecord = JSON.parse(await readFile(join(shared.identity.paths.reflection, "pending.json"), "utf8")) as ReservedRun
    expect(activeRecord.runId).not.toBe(pendingRecord.runId)

    const store = new ReflectionReservationStore({
      identity: shared.identity,
      config: {},
      getJournal: async (conversationId) => {
        throw new Error(`unexpected journal access: ${conversationId}`)
      },
    })
    const completion = await store.complete(activeRecord.runId, "failed")
    const promoted = await store.readState()
    expect(completion.launch?.runId).toBe(pendingRecord.runId)
    expect(promoted.active?.runId).toBe(pendingRecord.runId)
    expect(promoted.pending).toBeUndefined()
    expect((JSON.parse(await readFile(join(shared.identity.paths.reflection, "active.lock"), "utf8")) as ReservedRun).runId).toBe(pendingRecord.runId)
  }, 30_000)
})
