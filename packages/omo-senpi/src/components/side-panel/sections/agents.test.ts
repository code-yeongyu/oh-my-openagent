import { describe, expect, test } from "bun:test"

import type { PanelChild } from "../store"
import { buildAgentCardRows, buildAgentRows } from "./agents"

const child = (overrides: Partial<PanelChild> = {}): PanelChild => ({
  id: "c1",
  name: "explore",
  status: "running",
  startedAt: 0,
  ...overrides,
})

const texts = (rows: readonly { text: string }[]): string[] => rows.map((row) => row.text)

describe("buildAgentRows", () => {
  test("#given no children #when built #then the section stays empty", () => {
    // given
    const children: readonly PanelChild[] = []

    // when
    const rows = buildAgentRows(children, 1_000, 40)

    // then
    expect(rows).toEqual([])
  })

  test("#given running and finished children #when built #then the heading counts both", () => {
    // given
    const children = [child({ id: "a" }), child({ id: "b", status: "finished", finishedAt: 500 })]

    // when
    const rows = buildAgentRows(children, 1_000, 40)

    // then
    expect(rows[0]?.text).toBe("AGENTS  1 running · 1 done")
  })

  test("#given only finished children #when built #then the heading drops the running count", () => {
    // given
    const children = [child({ status: "finished", finishedAt: 500 })]

    // when
    const rows = buildAgentRows(children, 1_000, 40)

    // then
    expect(rows[0]?.text).toBe("AGENTS  1 done")
  })

  test("#given a running child #when built #then its row shows live elapsed time and current activity", () => {
    // given
    const children = [child({ activity: "reading files", startedAt: 40_000 })]

    // when
    const rows = texts(buildAgentRows(children, 130_000, 60))

    // then
    expect(rows[1]).toBe("● explore  1m30  reading files")
  })

  test("#given a finished child #when built #then its row freezes at the time it took", () => {
    // given
    const children = [child({ status: "finished", startedAt: 10_000, finishedAt: 70_000, activity: "stale" })]

    // when
    const rows = texts(buildAgentRows(children, 999_000, 60))

    // then
    expect(rows[1]).toBe("✓ explore  1m00")
  })

  test("#given each status #when built #then the glyph and colour differ per state", () => {
    // given
    const children = [
      child({ id: "q", status: "queued" }),
      child({ id: "r", status: "running" }),
      child({ id: "f", status: "finished", finishedAt: 1 }),
      child({ id: "x", status: "failed", finishedAt: 1 }),
      child({ id: "c", status: "cancelled", finishedAt: 1 }),
    ]

    // when
    const rows = buildAgentRows(children, 1_000, 40).slice(1)

    // then
    expect(rows.map((row) => row.text[0])).toEqual(["◦", "●", "✓", "✗", "—"])
    expect(rows[3]?.color).toBe("error")
  })

  test("#given a row wider than the column #when built #then it is cut to the column", () => {
    // given
    const children = [child({ name: "a-very-long-child-name", activity: "doing something lengthy" })]

    // when
    const rows = buildAgentRows(children, 1_000, 20)

    // then
    expect(rows[1]?.text.length).toBeLessThanOrEqual(20)
  })
})

describe("agent clicks and card", () => {
  const child = {
    id: "st_1",
    name: "explore",
    status: "running" as const,
    startedAt: 0,
    category: "deep",
    activity: "read a.ts",
    turns: 3,
    tokens: 1_200,
    cost: 0.42,
  }

  test("#given a child row #when built #then the click carries its id", () => {
    // when
    const rows = buildAgentRows([child], 60_000, 40)

    // then
    expect(rows[1]?.action).toEqual({ kind: "agent", id: "st_1" })
    expect(rows[0]?.action).toBeUndefined()
  })

  test("#given a child #when the card is built #then it carries what the narrow row could not", () => {
    // when
    const texts = buildAgentCardRows(child, 60_000).map((row) => row.text)

    // then
    expect(texts.some((text) => text.startsWith("status"))).toBe(true)
    expect(texts.some((text) => text.startsWith("category"))).toBe(true)
    expect(texts.some((text) => text.startsWith("cost"))).toBe(true)
    expect(texts.some((text) => text.includes("st_1"))).toBe(true)
  })

  test("#given a child that knows little #when the card is built #then absent fields are omitted", () => {
    // when
    const texts = buildAgentCardRows({ id: "st_2", name: "x", status: "queued", startedAt: 0 }, 1_000).map((r) => r.text)

    // then
    expect(texts.some((text) => text.startsWith("cost"))).toBe(false)
    expect(texts.some((text) => text.startsWith("turns"))).toBe(false)
  })
})
