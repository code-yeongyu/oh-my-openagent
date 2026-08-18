import { afterEach, describe, expect, test } from "bun:test"

import { collectReflection } from "./reflection-collector"
import { cleanupPalaceFixtures, createPalaceFixture } from "./palace.test-support"

afterEach(cleanupPalaceFixtures)

describe("palace reflection collector", () => {
  test("#given journal state and completion records #when reflection data is collected #then cursor state and recent outcomes are returned newest first", async () => {
    const fixture = await createPalaceFixture()
    await fixture.writeCompletion("run-old", { runId: "run-old", outcome: "merged", finishedAt: "2026-01-01T00:00:00.000Z" })
    await fixture.writeCompletion("run-new", { runId: "run-new", outcome: "failed", finishedAt: "2026-02-01T00:00:00.000Z" })

    const reflection = await collectReflection(fixture.paths, { limit: 5 })

    expect(reflection.cursor?.total_completed_steps).toBe(2)
    expect(reflection.cursor?.reflected_completed_steps).toBe(1)
    expect(reflection.outcomes.map((entry) => entry.runId)).toEqual(["run-new", "run-old"])
    expect(reflection.outcomes[0]?.outcome).toBe("failed")
  }, 30_000)

  test("#given more completion records than the limit #when reflection data is collected #then only the newest N are kept", async () => {
    const fixture = await createPalaceFixture()
    for (let index = 0; index < 5; index += 1) {
      await fixture.writeCompletion(`run-${index}`, {
        runId: `run-${index}`,
        outcome: "merged",
        finishedAt: `2026-03-0${index + 1}T00:00:00.000Z`,
      })
    }

    const reflection = await collectReflection(fixture.paths, { limit: 2 })

    expect(reflection.outcomes.map((entry) => entry.runId)).toEqual(["run-4", "run-3"])
  }, 30_000)
})
