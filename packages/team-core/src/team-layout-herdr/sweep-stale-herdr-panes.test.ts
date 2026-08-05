/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test"

import { sweepStaleHerdrPanesWith, TEAM_PANE_TITLE_PATTERN } from "./sweep-stale-herdr-panes"

const ACTIVE_RUN_ID = "11111111-1111-4111-8111-111111111111"
const STALE_RUN_ID = "22222222-2222-4222-8222-222222222222"

function makeDeps(overrides: Partial<Parameters<typeof sweepStaleHerdrPanesWith>[2]> = {}) {
  const closePaneMock = mock(async (_herdrPath: string, paneId: string) => {
    closedPaneIds.push(paneId)
    return true
  })
  const closedPaneIds: Array<string> = []
  return {
    deps: {
      getHerdrPath: async () => "herdr",
      listPaneIds: async () => ["w1:p1", "w1:p2", "w1:p3"],
      readPaneTitle: async (_herdrPath: string, paneId: string) => {
        if (paneId === "w1:p1") return `omo-team-${ACTIVE_RUN_ID}-alice`
        if (paneId === "w1:p2") return `omo-team-${STALE_RUN_ID}-bob`
        return "some-other-title"
      },
      closePane: closePaneMock,
      log: () => undefined,
      ...overrides,
    },
    closedPaneIds,
    closePaneMock,
  }
}

describe("TEAM_PANE_TITLE_PATTERN", () => {
  test("matches team pane titles with a uuid run id", () => {
    const match = `omo-team-${ACTIVE_RUN_ID}-alice`.match(TEAM_PANE_TITLE_PATTERN)
    expect(match?.[1]).toBe(ACTIVE_RUN_ID)
  })

  test("does not match non-team titles", () => {
    expect("some-other-title".match(TEAM_PANE_TITLE_PATTERN)).toBeNull()
  })
})

describe("sweepStaleHerdrPanesWith", () => {
  beforeEach(() => {
    // no-op
  })

  test("closes panes whose team run is inactive", async () => {
    const { deps, closedPaneIds } = makeDeps()
    const swept = await sweepStaleHerdrPanesWith("w1", new Set([ACTIVE_RUN_ID]), deps)

    expect(swept).toEqual(["w1:p2"])
    expect(closedPaneIds).toEqual(["w1:p2"])
  })

  test("keeps panes of active runs", async () => {
    const { deps, closedPaneIds } = makeDeps()
    const swept = await sweepStaleHerdrPanesWith("w1", new Set([ACTIVE_RUN_ID, STALE_RUN_ID]), deps)

    expect(swept).toEqual([])
    expect(closedPaneIds).toEqual([])
  })

  test("returns empty when herdr is not on path", async () => {
    const { deps, closedPaneIds } = makeDeps({ getHerdrPath: async () => null })
    const swept = await sweepStaleHerdrPanesWith("w1", new Set(), deps)

    expect(swept).toEqual([])
    expect(closedPaneIds).toEqual([])
  })
})
