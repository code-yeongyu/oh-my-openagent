import { describe, expect, test } from "bun:test"

import { parseMemoryFile, parsePeopleCard } from "@oh-my-opencode/memory-core"

import { MemoryFakeExtensionAPI } from "../memory.test-support"
import { fakeCommandContext, fakeDeps, invoke } from "./commands.test-support"
import { OBSERVATIONS_PER_LEVEL, registerPeopleCommand, selectObservations } from "./people"
import { JANE_CARD, LIMITS, peopleFixture } from "./people.test-support"

describe("observation selection", () => {
  test("#given more observations than the per-level cap #when they are selected #then each level keeps the newest twenty, newest first", async () => {
    // given
    const identity = await peopleFixture(25)
    const deps = fakeDeps(identity)

    // when
    const groups = await selectObservations(deps, identity, "jane-doe", LIMITS, { all: false })

    // then
    const explicit = groups.find((group) => group.section === "Explicit")
    expect(OBSERVATIONS_PER_LEVEL).toBe(20)
    expect(explicit?.entries.length).toBe(20)
    expect(explicit?.entries[0]?.date).toBe("2026-03-25")
    expect(explicit?.entries.at(-1)?.date).toBe("2026-03-06")
    expect(groups.find((group) => group.section === "Inductive")?.entries.length).toBe(1)
  }, 30_000)

  test("#given the all flag #when observations are selected #then every entry survives", async () => {
    // given
    const identity = await peopleFixture(25)
    const deps = fakeDeps(identity)

    // when
    const groups = await selectObservations(deps, identity, "jane-doe", LIMITS, { all: true })

    // then
    expect(groups.find((group) => group.section === "Explicit")?.entries.length).toBe(25)
  }, 30_000)
})

describe("/people command", () => {
  test("#given a person with observations #when /people <name> runs #then parsed card fields and capped observation selection are surfaced", async () => {
    // given
    const identity = await peopleFixture(25)
    const deps = fakeDeps(identity)
    const pi = new MemoryFakeExtensionAPI()
    registerPeopleCommand(pi, deps)
    const ctx = fakeCommandContext()

    // when
    const card = parsePeopleCard(parseMemoryFile(JANE_CARD).body, LIMITS).card
    const observations = await selectObservations(deps, identity, "jane-doe", LIMITS, { all: false })
    const text = await invoke(pi, "people", "Jane", ctx)

    // then
    expect(card.entries).toEqual([
      { prefix: "IDENTITY", content: "staff engineer" },
      { prefix: "ATTRIBUTE", content: "prefers small diffs" },
      { prefix: "RELATIONSHIP", content: "reports-to: human" },
    ])
    expect(observations.find((group) => group.section === "Explicit")?.entries.map((entry) => entry.date)).toEqual(
      Array.from({ length: 20 }, (_, index) => `2026-03-${String(25 - index).padStart(2, "0")}`),
    )
    expect(ctx.ui.notifications).toEqual([{ message: text, level: "info" }])
  }, 30_000)
})
