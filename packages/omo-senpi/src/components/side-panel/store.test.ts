import { describe, expect, test } from "bun:test"

import { AGENT_ROW_CAP, TOOL_ROW_CAP } from "./constants"
import { createPanelStore } from "./store"

function clock(start = 1_000): () => number {
  let value = start
  return () => {
    value += 1
    return value
  }
}

describe("panel store children", () => {
  test("#given a spawn then a finish #when upserted #then the row keeps the fields the finish omits", () => {
    // given
    const store = createPanelStore(clock())
    store.upsertChild({ id: "c1", name: "explore", category: "deep", status: "running", startedAt: 100 })

    // when
    store.upsertChild({ id: "c1", status: "finished", finishedAt: 900, tokens: 1_500, cost: 0.42 })

    // then
    const child = store.state().children[0]
    expect(child?.name).toBe("explore")
    expect(child?.category).toBe("deep")
    expect(child?.startedAt).toBe(100)
    expect(child?.status).toBe("finished")
    expect(child?.tokens).toBe(1_500)
  })

  test("#given an unchanged update #when upserted #then it reports no change", () => {
    // given
    const store = createPanelStore(clock())
    store.upsertChild({ id: "c1", name: "explore", status: "running", startedAt: 100 })

    // when
    const changed = store.upsertChild({ id: "c1", name: "explore", status: "running", startedAt: 100 })

    // then
    expect(changed).toBe(false)
  })

  test("#given children spawned out of order #when read #then rows are ordered by start time", () => {
    // given
    const store = createPanelStore(clock())
    store.upsertChild({ id: "late", status: "running", startedAt: 300 })
    store.upsertChild({ id: "early", status: "running", startedAt: 100 })

    // when
    const ids = store.state().children.map((child) => child.id)

    // then
    expect(ids).toEqual(["early", "late"])
  })

  test("#given more finished children than the cap #when upserted #then the oldest finished rows are dropped", () => {
    // given
    const store = createPanelStore(clock())
    for (let index = 0; index < AGENT_ROW_CAP + 4; index += 1) {
      store.upsertChild({ id: `c${index}`, status: "finished", startedAt: index, finishedAt: index + 1 })
    }

    // when
    const ids = store.state().children.map((child) => child.id)

    // then
    expect(ids).toHaveLength(AGENT_ROW_CAP)
    expect(ids).not.toContain("c0")
    expect(ids).toContain(`c${AGENT_ROW_CAP + 3}`)
  })

  test("#given the cap is full of running children #when another spawns #then nothing is evicted", () => {
    // given
    const store = createPanelStore(clock())
    for (let index = 0; index < AGENT_ROW_CAP + 3; index += 1) {
      store.upsertChild({ id: `r${index}`, status: "running", startedAt: index })
    }

    // when
    const children = store.state().children

    // then
    expect(children).toHaveLength(AGENT_ROW_CAP + 3)
    expect(children.every((child) => child.status === "running")).toBe(true)
  })

  test("#given a mix over the cap #when evicting #then running rows survive and finished ones go first", () => {
    // given
    const store = createPanelStore(clock())
    store.upsertChild({ id: "runner", status: "running", startedAt: 0 })
    for (let index = 0; index < AGENT_ROW_CAP + 2; index += 1) {
      store.upsertChild({ id: `done${index}`, status: "finished", startedAt: index + 1, finishedAt: index + 2 })
    }

    // when
    const ids = store.state().children.map((child) => child.id)

    // then
    expect(ids).toContain("runner")
    expect(ids).toHaveLength(AGENT_ROW_CAP)
  })
})

describe("panel store child spend", () => {
  test("#given a child that finishes #when its cost arrives #then it is counted once", () => {
    // given
    const store = createPanelStore(clock())
    store.upsertChild({ id: "c1", status: "running", startedAt: 1 })

    // when
    store.upsertChild({ id: "c1", status: "finished", finishedAt: 2, cost: 0.25 })
    store.upsertChild({ id: "c1", status: "finished", finishedAt: 2, cost: 0.25, activity: "done" })

    // then
    expect(store.state().childSpend).toBeCloseTo(0.25, 6)
  })

  test("#given several finished children #when their costs arrive #then the ledger sums them", () => {
    // given
    const store = createPanelStore(clock())

    // when
    store.upsertChild({ id: "a", status: "finished", startedAt: 1, finishedAt: 2, cost: 0.1 })
    store.upsertChild({ id: "b", status: "failed", startedAt: 1, finishedAt: 3, cost: 0.2 })

    // then
    expect(store.state().childSpend).toBeCloseTo(0.3, 6)
  })

  test("#given a running child carrying a cost #when it has not stopped #then nothing is counted yet", () => {
    // given
    const store = createPanelStore(clock())

    // when
    store.upsertChild({ id: "a", status: "running", startedAt: 1, cost: 0.9 })

    // then
    expect(store.state().childSpend).toBe(0)
  })
})

describe("panel store tools", () => {
  test("#given more calls than the cap #when recorded #then only the most recent survive in order", () => {
    // given
    const store = createPanelStore(clock())
    for (let index = 0; index < TOOL_ROW_CAP + 3; index += 1) {
      store.recordTool({ name: `tool${index}`, at: index })
    }

    // when
    const names = store.state().tools.map((call) => call.name)

    // then
    expect(names).toHaveLength(TOOL_ROW_CAP)
    expect(names[0]).toBe("tool3")
    expect(names[names.length - 1]).toBe(`tool${TOOL_ROW_CAP + 2}`)
  })

  test("#given recorded calls #when the exchange ends #then the list is cleared", () => {
    // given
    const store = createPanelStore(clock())
    store.recordTool({ name: "read", at: 1 })

    // when
    store.clearTools()

    // then
    expect(store.state().tools).toEqual([])
  })

  test("#given a state snapshot #when the store changes afterwards #then the snapshot does not mutate", () => {
    // given
    const store = createPanelStore(clock())
    store.recordTool({ name: "read", at: 1 })
    const snapshot = store.state()

    // when
    store.recordTool({ name: "edit", at: 2 })

    // then
    expect(snapshot.tools).toHaveLength(1)
  })
})
