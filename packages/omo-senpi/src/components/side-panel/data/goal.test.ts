import { describe, expect, test } from "bun:test"

import type { PanelGoalSource } from "../types"
import { createPanelGoalReader } from "./goal"

const PATH = "/state/goal.json"

const record = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    version: 1,
    goal: {
      id: "g-1",
      threadId: "t-1",
      objective: "Extend the side panel with the subsystems omo gained since beta.53",
      status: "active",
      tokensUsed: 148_000,
      timeUsedSeconds: 8_040,
      consecutiveContinuations: 6,
      unattendedContinuations: 4,
      createdAt: 1_789_968_789,
      updatedAt: 1_789_969_000,
      lastStartedAt: 1_789_968_800,
      ...overrides,
    },
  })

/** Counts reads so the stat gate can be proven rather than assumed. */
function fakeSource(initial?: string) {
  const files = new Map<string, string>()
  if (initial !== undefined) files.set(PATH, initial)
  let mtimeMs = 1_000
  let reads = 0
  const port: PanelGoalSource = {
    stat(path) {
      const body = files.get(path)
      return body === undefined ? undefined : { mtimeMs, size: body.length }
    },
    read(path) {
      reads += 1
      return files.get(path)
    },
  }
  return {
    port,
    reads: () => reads,
    rewrite(body: string) {
      files.set(PATH, body)
      mtimeMs += 1_000
    },
  }
}

describe("createPanelGoalReader", () => {
  test("#given a goal store file #when read #then the column gets the facts it draws", () => {
    // given
    const source = fakeSource(record())

    // when
    const goal = createPanelGoalReader(source.port)(PATH)

    // then
    expect(goal).toEqual({
      objective: "Extend the side panel with the subsystems omo gained since beta.53",
      status: "active",
      tokensUsed: 148_000,
      timeUsedSeconds: 8_040,
      consecutiveContinuations: 6,
      unattendedContinuations: 4,
    })
  })

  test("#given a token budget #when read #then it comes through for the bar", () => {
    // given
    const source = fakeSource(record({ tokenBudget: 300_000 }))

    // when / then
    expect(createPanelGoalReader(source.port)(PATH)?.tokenBudget).toBe(300_000)
  })

  test("#given no goal store path #when read #then nothing is read at all", () => {
    // given a session that never registered a goal is the ordinary case
    const source = fakeSource(record())

    // when
    const goal = createPanelGoalReader(source.port)(undefined)

    // then
    expect(goal).toBeUndefined()
    expect(source.reads()).toBe(0)
  })

  test("#given the file does not exist #when read #then the section stays silent", () => {
    // given reading the path must not create it, so absence is normal
    const source = fakeSource()

    // when / then
    expect(createPanelGoalReader(source.port)(PATH)).toBeUndefined()
  })

  test("#given a half-written file #when read #then it degrades instead of throwing", () => {
    // given the store's own loader carries a recovery branch, so a torn read is real
    const source = fakeSource(record().slice(0, 120))

    // when / then
    expect(createPanelGoalReader(source.port)(PATH)).toBeUndefined()
  })

  test("#given a torn read with unchanged metadata #when retried #then the completed record is parsed", () => {
    // given the replacement can keep the same mtime and size on coarse filesystems
    const body = record()
    let reads = 0
    const source: PanelGoalSource = {
      stat: () => ({ mtimeMs: 1_000, size: body.length }),
      read: () => {
        reads += 1
        return reads === 1 ? "x".repeat(body.length) : body
      },
    }
    const read = createPanelGoalReader(source)

    // when
    expect(read(PATH)).toBeUndefined()
    const goal = read(PATH)

    // then
    expect(goal?.status).toBe("active")
    expect(reads).toBe(2)
  })

  test("#given a status senpi does not write #when read #then it is not shown raw", () => {
    // given
    const source = fakeSource(record({ status: "sideways" }))

    // when / then
    expect(createPanelGoalReader(source.port)(PATH)).toBeUndefined()
  })

  test("#given a record missing the optional counters #when read #then they read as zero", () => {
    // given an older or partial record must not blank the whole section
    const body = JSON.stringify({
      version: 1,
      goal: { objective: "Ship it", status: "blocked", tokensUsed: 10, timeUsedSeconds: 20 },
    })
    const source = fakeSource(body)

    // when
    const goal = createPanelGoalReader(source.port)(PATH)

    // then
    expect(goal?.status).toBe("blocked")
    expect(goal?.consecutiveContinuations).toBe(0)
    expect(goal?.unattendedContinuations).toBe(0)
    expect(goal?.tokenBudget).toBeUndefined()
  })

  test("#given the file has not changed #when read again #then it is not parsed twice", () => {
    // given this runs on every panel refresh, so an unchanged file must cost one stat
    const source = fakeSource(record())
    const read = createPanelGoalReader(source.port)

    // when
    read(PATH)
    read(PATH)
    read(PATH)

    // then
    expect(source.reads()).toBe(1)
  })

  test("#given the goal was updated #when read again #then the new numbers are picked up", () => {
    // given
    const source = fakeSource(record())
    const read = createPanelGoalReader(source.port)
    expect(read(PATH)?.tokensUsed).toBe(148_000)

    // when
    source.rewrite(record({ tokensUsed: 200_000, status: "complete" }))

    // then
    const goal = read(PATH)
    expect(goal?.tokensUsed).toBe(200_000)
    expect(goal?.status).toBe("complete")
    expect(source.reads()).toBe(2)
  })
})

describe("current and legacy goal statuses", () => {
  // Senpi's installed `core/extensions/builtin/goal/types.d.ts` exports active, paused, blocked,
  // and complete. budgetLimited remains readable for persisted records from the earlier goal
  // extension, so an upgrade does not blank the block before that record is rewritten.
  for (const status of ["active", "paused", "blocked", "budgetLimited", "complete"] as const) {
    test(`#given a ${status} goal #when read #then the record reaches the column`, () => {
      // given
      const source = fakeSource(record({ status }))

      // when
      const goal = createPanelGoalReader(source.port)(PATH)

      // then
      expect(goal?.status).toBe(status)
    })
  }
})
