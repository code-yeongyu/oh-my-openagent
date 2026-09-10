import { describe, expect, test } from "bun:test"

import { OmoSidePanelSettingsSchema, type OmoSidePanelSections } from "@oh-my-opencode/omo-config-core"

import { buildPanelRows, type PanelRowsInput } from "./rows"
import { createPanelStore } from "./store"

const allSections = (overrides: Partial<OmoSidePanelSections> = {}): OmoSidePanelSections => ({
  ...OmoSidePanelSettingsSchema.parse({}).sections,
  ...overrides,
})

function input(overrides: Partial<PanelRowsInput> = {}): PanelRowsInput {
  const store = createPanelStore(() => 1_000)
  return {
    sections: allSections(),
    facts: {},
    state: store.state(),
    location: { cwd: "/srv/app" },
    now: 1_000,
    toolRows: 4,
    fileRows: 8,
    ...overrides,
  }
}

const texts = (rows: readonly { text: string }[]): string[] => rows.map((row) => row.text)

describe("buildPanelRows", () => {
  test("#given a session that knows nothing yet #when assembled #then only the location line remains", () => {
    // given
    const source = input()

    // when
    const rows = texts(buildPanelRows(source, 40))

    // then
    expect(rows).toEqual(["/srv/app"])
  })

  test("#given every section has content #when assembled #then blocks are separated by one blank row each", () => {
    // given
    const store = createPanelStore(() => 1_000)
    store.upsertChild({ id: "c1", name: "explore", status: "running", startedAt: 0 })
    store.recordTool({ name: "read", detail: "index.ts", at: 1 })
    const source = input({
      state: store.state(),
      facts: {
        model: "opus",
        usage: { tokens: 1_000, contextWindow: 100_000, percent: 1 },
        totals: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.1 },
      },
      startedAt: 0,
    })

    // when
    const rows = texts(buildPanelRows(source, 46))

    // then
    expect(rows.filter((row) => row === "")).toHaveLength(4)
    expect(rows[0]?.startsWith("SESSION")).toBe(true)
    expect(rows).toContain("CONTEXT  1K/100K")
    expect(rows.some((row) => row.startsWith("AGENTS"))).toBe(true)
    expect(rows.some((row) => row.startsWith("TOOLS"))).toBe(true)
    expect(rows[rows.length - 1]).toBe("/srv/app")
  })

  test("#given a disabled section #when assembled #then it contributes nothing at all", () => {
    // given
    const source = input({
      sections: allSections({ context: false }),
      facts: { usage: { tokens: 1_000, contextWindow: 100_000, percent: 1 } },
    })

    // when
    const rows = texts(buildPanelRows(source, 40))

    // then
    expect(rows.some((row) => row.startsWith("CONTEXT"))).toBe(false)
  })

  test("#given every section disabled #when assembled #then the location line still closes the column", () => {
    // given
    const source = input({
      sections: allSections({ session: false, context: false, agents: false, tools: false, files: false, memory: false }),
    })

    // when
    const rows = texts(buildPanelRows(source, 40))

    // then
    expect(rows).toEqual(["/srv/app"])
  })

  test("#given no width #when assembled #then nothing is produced", () => {
    // given
    const source = input()

    // when
    const rows = buildPanelRows(source, 0)

    // then
    expect(rows).toEqual([])
  })
})
