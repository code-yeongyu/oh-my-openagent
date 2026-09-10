import { describe, expect, test } from "bun:test"

import { panelChildFromRecord, panelChildrenFromRecords, type PanelTaskRecord } from "./task-records"

const record = (overrides: Partial<PanelTaskRecord> = {}): PanelTaskRecord => ({
  task_id: "t1",
  status: "running",
  created_at: "2026-09-10T10:00:00.000Z",
  parent_session_id: "session-1",
  ...overrides,
})

describe("panelChildFromRecord", () => {
  test("#given every task status #when mapped #then it lands on the panel vocabulary", () => {
    // given
    const statuses = ["pending", "running", "completed", "error", "lost", "cancelled", "interrupted", "wat"]

    // when
    const mapped = statuses.map((status) => panelChildFromRecord(record({ status })).status)

    // then
    expect(mapped).toEqual([
      "queued",
      "running",
      "finished",
      "failed",
      "failed",
      "cancelled",
      "cancelled",
      "queued",
    ])
  })

  test("#given a summary, a description and a name #when mapped #then the summary wins", () => {
    // given
    const input = record({ task_summary: "map the seams", description: "explore", name: "child" })

    // when
    const child = panelChildFromRecord(input)

    // then
    expect(child.name).toBe("map the seams")
  })

  test("#given only an agent type #when mapped #then it stands in as the label", () => {
    // given
    const input = record({ agent_type: "explore" })

    // when
    const child = panelChildFromRecord(input)

    // then
    expect(child.name).toBe("explore")
  })

  test("#given no label at all #when mapped #then the task id is used", () => {
    // given
    const input = record({ task_summary: "   " })

    // when
    const child = panelChildFromRecord(input)

    // then
    expect(child.name).toBe("t1")
  })

  test("#given start and terminal timestamps #when mapped #then they become epoch milliseconds", () => {
    // given
    const input = record({
      started_at: "2026-09-10T10:00:05.000Z",
      terminal_at: "2026-09-10T10:01:05.000Z",
      status: "completed",
    })

    // when
    const child = panelChildFromRecord(input)

    // then
    expect(child.finishedAt! - child.startedAt!).toBe(60_000)
  })

  test("#given no started_at #when mapped #then creation time is the start", () => {
    // given
    const input = record()

    // when
    const child = panelChildFromRecord(input)

    // then
    expect(child.startedAt).toBe(Date.parse("2026-09-10T10:00:00.000Z"))
  })

  test("#given run stats without a cost #when mapped #then cost stays absent rather than zero", () => {
    // given
    const input = record({ run_stats: { turns: 3, total_tokens: 4_200 } })

    // when
    const child = panelChildFromRecord(input)

    // then
    expect(child.turns).toBe(3)
    expect(child.tokens).toBe(4_200)
    expect("cost" in child).toBe(false)
  })

  test("#given a reported cost #when mapped #then it is carried through", () => {
    // given
    const input = record({ run_stats: { cost_usd: 0.42 } })

    // when
    const child = panelChildFromRecord(input)

    // then
    expect(child.cost).toBe(0.42)
  })
})

describe("panelChildrenFromRecords", () => {
  test("#given records from several sessions #when scoped #then only this session's children remain", () => {
    // given
    const records = [record({ task_id: "mine" }), record({ task_id: "theirs", parent_session_id: "session-2" })]

    // when
    const children = panelChildrenFromRecords(records, "session-1")

    // then
    expect(children.map((child) => child.id)).toEqual(["mine"])
  })

  test("#given no session id #when scoped #then nothing is returned", () => {
    // given
    const records = [record()]

    // when
    const children = panelChildrenFromRecords(records, undefined)

    // then
    expect(children).toEqual([])
  })
})
