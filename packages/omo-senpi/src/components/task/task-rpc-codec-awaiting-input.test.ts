import { describe, expect, test } from "bun:test"

import { buildTaskSnapshot } from "@oh-my-opencode/senpi-task"

import { taskRecord } from "./event-bridge.test-fixtures"
import { taskSnapshot } from "./task-rpc-codec"

// senpi#3266: the RPC task snapshot (omo-desktop's status source) shows the "resumed, waiting for
// input" flag in exactly the shape and terminal filter task_output uses.

const FLAG = { reason: "resumed_turn_aborted" as const, since: "2026-08-11T00:00:01.000Z" }

describe("task RPC snapshot awaiting_input (senpi#3266)", () => {
  test("#given a running flagged record #when the RPC snapshot is built #then it carries task_output's awaiting_input", () => {
    // given
    const record = taskRecord({ task_id: "st_flagged", status: "running", awaiting_input: FLAG })

    // when
    const snapshot = taskSnapshot(record, undefined, undefined)

    // then
    expect(snapshot.awaiting_input).toEqual(buildTaskSnapshot(record, "/tmp/state", Date.now()).awaiting_input)
    expect(snapshot.awaiting_input?.reason).toBe("resumed_turn_aborted")
  })

  test("#given a completed record still carrying a stale flag #when the RPC snapshot is built #then no awaiting_input is shown", () => {
    // given
    const record = taskRecord({ task_id: "st_done", status: "completed", awaiting_input: FLAG })

    // when
    const snapshot = taskSnapshot(record, undefined, undefined)

    // then
    expect(snapshot.awaiting_input).toBeUndefined()
  })
})
