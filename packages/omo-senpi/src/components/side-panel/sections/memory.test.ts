import { describe, expect, test } from "bun:test"

import type { PanelMemory, PanelRow } from "../types"
import { buildMemoryDetailRows, buildMemoryRows } from "./memory"

const NOW = Date.parse("2026-09-21T12:00:00.000Z")

const memory = (overrides: Partial<PanelMemory> = {}): PanelMemory => ({
  identity: "notwork-09334074",
  factsQueued: 0,
  recallSurfaced: 0,
  recallPending: 0,
  ...overrides,
})

const texts = (rows: readonly PanelRow[]): string[] => rows.map((row) => row.text)
const row = (rows: readonly PanelRow[], label: string): PanelRow | undefined =>
  rows.find((entry) => entry.text.startsWith(label))

describe("buildMemoryRows", () => {
  test("#given a resolved identity #when built #then the heading names which memory this session writes to", () => {
    // given one machine carries many identities, and the wrong one is invisible without this line
    const rows = buildMemoryRows(memory(), NOW, 40)

    // then
    expect(rows[0]?.text).toBe("MEMORY  notwork-09334074")
    expect(rows[0]?.color).toBe("accent")
  })

  test("#given healthy memory with an empty backlog #when built #then the heading stands alone", () => {
    // given zero queued and zero failures is not news; the identity still is
    expect(buildMemoryRows(memory(), NOW, 40)).toHaveLength(1)
  })

  test("#given parked reflection #when built #then it warns and says when the probe is due", () => {
    // given a parked identity stops learning silently, which is the whole reason for this row
    const rows = buildMemoryRows(
      memory({
        reflection: {
          streak: 3,
          parkedAt: "2026-09-21T09:00:00.000Z",
          nextProbeAt: "2026-09-21T15:00:00.000Z",
          reason: "reflection sandbox refused to start",
        },
      }),
      NOW,
      44,
    )
    const reflect = row(rows, "reflect")

    // then
    expect(reflect?.text).toContain("parked")
    expect(reflect?.text).toContain("3h00")
    expect(reflect?.color).toBe("warning")
  })

  test("#given a parked identity #when the row is drawn #then it is a handle to the failure detail", () => {
    // given the actionable part is a 512-character detail that cannot fit in a column
    const rows = buildMemoryRows(
      memory({ reflection: { streak: 3, parkedAt: "2026-09-21T09:00:00.000Z", nextProbeAt: "2026-09-21T15:00:00.000Z" } }),
      NOW,
      44,
    )

    // then
    expect(row(rows, "reflect")?.action).toEqual({ kind: "memory" })
  })

  test("#given the probe window has passed #when built #then the row says it is due rather than counting backwards", () => {
    // given a negative countdown would read as a time that already worked
    const rows = buildMemoryRows(
      memory({ reflection: { streak: 3, parkedAt: "2026-09-20T09:00:00.000Z", nextProbeAt: "2026-09-21T09:00:00.000Z" } }),
      NOW,
      44,
    )

    // then
    expect(row(rows, "reflect")?.text).toContain("due")
    expect(row(rows, "reflect")?.text).not.toContain("-")
  })

  test("#given failures that have not parked #when built #then the streak is reported without alarm", () => {
    // given a retry streak is information; a park is a problem
    const rows = buildMemoryRows(memory({ reflection: { streak: 2 } }), NOW, 40)
    const reflect = row(rows, "reflect")

    // then
    expect(reflect?.text).toContain("2")
    expect(reflect?.color).toBe("muted")
  })

  test("#given a facts backlog #when built #then the queued count is shown", () => {
    // given facts pile up when reflection cannot drain them, which is the tell
    expect(row(buildMemoryRows(memory({ factsQueued: 3 }), NOW, 40), "facts")?.text).toContain("3 queued")
  })

  test("#given recall surfaced memory this session #when built #then the count is shown", () => {
    // given
    expect(row(buildMemoryRows(memory({ recallSurfaced: 12 }), NOW, 40), "recall")?.text).toContain("12 surfaced")
  })

  test("#given nudges waiting for the next prompt #when built #then waiting comes before surfaced", () => {
    // given what is about to arrive matters more than what already did
    const rows = buildMemoryRows(memory({ recallPending: 1, recallSurfaced: 12 }), NOW, 44)
    const recall = row(rows, "recall")

    // then
    expect(recall?.text.indexOf("waiting")).toBeLessThan(recall?.text.indexOf("surfaced") ?? -1)
  })

  test("#given an empty backlog #when built #then no zero rows are invented", () => {
    // given
    const rows = buildMemoryRows(memory(), NOW, 40)

    // then
    expect(texts(rows).some((text) => text.startsWith("facts") || text.startsWith("recall"))).toBe(false)
  })

  test("#given no memory at all #when built #then the section is absent, not an empty heading", () => {
    // given memory off, or an identity that would not resolve
    expect(buildMemoryRows(undefined, NOW, 40)).toEqual([])
  })

  test("#given no width #when built #then nothing is drawn", () => {
    // given
    expect(buildMemoryRows(memory(), NOW, 0)).toEqual([])
  })

  test("#given a long identity #when built #then the heading stays inside the column", () => {
    // given an explicit `memory.agent` can be 40 characters before the hash is appended
    const rows = buildMemoryRows(memory({ identity: "a-very-long-explicit-memory-identity-name-0badc0de" }), NOW, 32)

    // then
    expect(rows[0]?.text.length).toBeLessThanOrEqual(32)
  })
})

describe("buildMemoryDetailRows", () => {
  test("#given a parked identity #when the frame is opened #then it carries the detail the row could not hold", () => {
    // given the 512-character failure detail is the actionable part, and the click exists for it
    const rows = buildMemoryDetailRows(
      memory({
        reflection: {
          streak: 3,
          parkedAt: "2026-09-21T09:00:00.000Z",
          nextProbeAt: "2026-09-21T15:00:00.000Z",
          reason: "reflection sandbox refused to start",
          detail: "bwrap: Creating new namespace failed: Operation not permitted. ".repeat(6),
        },
        factsQueued: 3,
        recallSurfaced: 12,
      }),
      NOW,
    )
    const joined = texts(rows).join("\n")

    // then
    expect(joined).toContain("notwork-09334074")
    expect(joined).toContain("2026-09-21T09:00:00.000Z")
    expect(joined).toContain("reflection sandbox refused to start")
    expect(joined).toContain("Operation not permitted")
    expect(joined).toContain("3 queued")
  })

  test("#given a long detail #when the frame is opened #then it is wrapped rather than cut", () => {
    // given the viewer is narrow, and a truncated detail defeats the click that opened it
    const detail = "a".repeat(400)
    const rows = buildMemoryDetailRows(
      memory({ reflection: { streak: 3, parkedAt: "2026-09-21T09:00:00.000Z", detail } }),
      NOW,
    )

    // then
    expect(rows.every((entry) => entry.text.length <= 60)).toBe(true)
    expect(texts(rows).join("").includes("a".repeat(400))).toBe(true)
  })

  test("#given healthy memory #when the frame is opened #then it still names the identity", () => {
    // given the frame is reachable while nothing is wrong
    expect(texts(buildMemoryDetailRows(memory(), NOW)).join("\n")).toContain("notwork-09334074")
  })

  test("#given a maximum-length identity #when the frame is opened #then its distinguishing tail is preserved", () => {
    // given
    const identity = "a-very-long-explicit-memory-identity-name-0badc0de"

    // when
    const rows = buildMemoryDetailRows(memory({ identity }), NOW)

    // then
    expect(rows.slice(0, 2).map((entry) => entry.text.slice(8)).join("")).toBe(identity)
  })
})

describe("the kibitzer row", () => {
  test("#given settled wakes #when built #then the column says how many and how long ago", () => {
    // given the sidecar is invisible otherwise: it runs in another process on its own schedule
    const rows = buildMemoryRows(
      memory({ kibitzer: { wakes: 4, lastWakeAt: "2026-09-21T11:48:00.000Z", lastFailed: false, nudged: 3, tokens: 20_400, partial: false } }),
      NOW,
      44,
    )
    const kibitz = row(rows, "kibitz")

    // then
    expect(kibitz?.text).toContain("4 wakes")
    expect(kibitz?.text).toContain("12m")
    expect(kibitz?.color).toBe("muted")
  })

  test("#given the last wake failed #when built #then the row warns and stays clickable", () => {
    // given a kibitzer failing every wake is a memory that quietly stopped being updated
    const rows = buildMemoryRows(
      memory({ kibitzer: { wakes: 3, lastWakeAt: "2026-09-21T11:48:00.000Z", lastFailed: true, lastStatus: "failed", nudged: 0, tokens: 900, partial: false } }),
      NOW,
      44,
    )

    // then
    expect(row(rows, "kibitz")?.color).toBe("warning")
    expect(row(rows, "kibitz")?.action).toEqual({ kind: "memory" })
  })

  test("#given only the tail of the log was read #when built #then the count is marked as a floor", () => {
    // given claiming an exact total from a truncated read would be a lie
    const rows = buildMemoryRows(
      memory({ kibitzer: { wakes: 40, lastWakeAt: "2026-09-21T11:48:00.000Z", lastFailed: false, nudged: 0, tokens: 0, partial: true } }),
      NOW,
      44,
    )

    // then
    expect(row(rows, "kibitz")?.text).toContain("40+ wakes")
  })

  test("#given a kibitzer that never woke #when built #then no row is invented", () => {
    // given
    expect(row(buildMemoryRows(memory(), NOW, 44), "kibitz")).toBeUndefined()
  })

  test("#given wakes #when the frame is opened #then it carries what the row had no room for", () => {
    // given nudged paths and token spend are the numbers worth reading slowly
    const text = buildMemoryDetailRows(
      memory({ kibitzer: { wakes: 4, lastWakeAt: "2026-09-21T11:48:00.000Z", lastFailed: false, nudged: 3, tokens: 20_400, partial: false } }),
      NOW,
    )
      .map((entry) => entry.text)
      .join("\n")

    // then
    expect(text).toContain("4 wakes")
    expect(text).toContain("3 nudged")
    expect(text).toContain("20.4K")
  })
})
