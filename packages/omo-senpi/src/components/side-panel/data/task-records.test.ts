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

describe("suspended children", () => {
  // The engine parks a host-session child instead of killing it when its daemon goes away or the
  // host drains (`senpi-task/src/lifecycle/host-session-record.ts`): the record keeps its status
  // and gains a reason. Reading only the status paints a parked child as a running one, and the
  // column's whole job for that row is to say what the child is doing.
  test("#given a running record the engine parked #when mapped #then the panel calls it suspended", () => {
    // given
    const parked = record({ status: "running", suspension_reason: "daemon_unavailable" })

    // when
    const child = panelChildFromRecord(parked)

    // then
    expect(child.status).toBe("resuming")
  })

  test("#given a finished record that still carries a reason #when mapped #then it stays finished", () => {
    // given a terminal record is not revivable, so a stale reason on it says nothing about now
    const done = record({ status: "completed", suspension_reason: "host_draining" })

    // when
    const child = panelChildFromRecord(done)

    // then
    expect(child.status).toBe("finished")
  })
})

describe("a child the engine is no longer holding in this process", () => {
  // senpi-task persists `residency_state` next to `status`: "resident" is the only value that
  // means the child is live here. rpc_detached / evicted / disposed / persisted_only all leave
  // `status: "running"` untouched, so reading status alone paints a detached child as working -
  // with an elapsed timer still climbing.
  const running = {
    task_id: "st_d1",
    status: "running",
    created_at: "2026-09-21T10:00:00.000Z",
    started_at: "2026-09-21T10:00:05.000Z",
    parent_session_id: "session-1",
    name: "explore",
  }

  test("#given a running child detached from its daemon #when mapped #then it is parked, not running", () => {
    // given the ordinary daemon suspension sets no suspension_reason at all
    const update = panelChildFromRecord({ ...running, residency_state: "rpc_detached" })

    // then
    expect(update.status).toBe("resuming")
    expect(update.parkedReason).toBe("parent session restarted")
  })

  test("#given a resident running child #when mapped #then nothing changes", () => {
    // given the common case must not regress into a parked row
    const update = panelChildFromRecord({ ...running, residency_state: "resident" })

    // then
    expect(update.status).toBe("running")
    expect(update.parkedReason).toBeUndefined()
  })

  test("#given both a suspension reason and a non-resident residency #when mapped #then the reason wins", () => {
    // given the reason is the specific fact; the residency state is only how it shows up
    const update = panelChildFromRecord({
      ...running,
      residency_state: "rpc_detached",
      suspension_reason: "daemon_unavailable",
    })

    // then
    expect(update.parkedReason).toBe("task daemon unavailable")
  })

  test("#given a finished record whose residency was disposed #when mapped #then it stays finished", () => {
    // given residency on a terminal record describes storage, not a life to worry about
    const update = panelChildFromRecord({
      ...running,
      status: "completed",
      terminal_at: "2026-09-21T10:30:00.000Z",
      residency_state: "disposed",
    })

    // then
    expect(update.status).toBe("finished")
  })

  test("#given a child the shared daemon runs #when mapped #then the update says where it runs", () => {
    // given runner_kind is persisted precisely because the two lanes fail differently
    expect(panelChildFromRecord({ ...running, runner_kind: "host-session" }).host).toBe("daemon session")
  })

  test("#given a child in the parent's own process #when mapped #then the update says so", () => {
    // given
    expect(panelChildFromRecord({ ...running, execution_mode: "in-process" }).host).toBe("in-process")
  })

  test("#given a record from before these fields shipped #when mapped #then nothing is invented", () => {
    // given every one of them is optional on the durable record
    const update = panelChildFromRecord(running)

    // then
    expect(update.status).toBe("running")
    expect(update.host).toBeUndefined()
  })
})
