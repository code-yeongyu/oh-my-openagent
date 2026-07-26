import { describe, expect, test } from "bun:test"

import { parseTaskRecord } from "../store/record-parse"
import { transitionTaskRecord } from "./transitions"
import type { TaskRecord, TaskRunStats } from "./types"

const RUN_STATS: TaskRunStats = {
  runtime_ms: 12_500,
  turns: 3,
  tool_calls: 5,
  output_tokens: 900,
  total_tokens: 4_200,
  generation_ms: 7_600,
  tokens_per_second: 118,
}

function runningRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: "st_deadbeef",
    status: "running",
    residency_state: "resident",
    parent_session_id: "parent-session",
    root_session_id: "root-session",
    depth: 1,
    execution_mode: "in-process",
    model: "gpt-5.2",
    created_at: "2026-07-06T01:00:00.000Z",
    updated_at: "2026-07-06T01:00:01.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
    ...overrides,
  }
}

describe("run stats on task records", () => {
  test("#given a complete transition with run stats #when applied #then the terminal record carries them", () => {
    // when
    const result = transitionTaskRecord(runningRecord(), {
      type: "complete",
      timestamp: "2026-07-06T01:00:12.500Z",
      final_response: "done",
      run_stats: RUN_STATS,
    })

    // then
    expect(result.applied).toBe(true)
    expect(result.record.run_stats).toEqual(RUN_STATS)
  })

  test("#given fail cancel and interrupt transitions #when applied with run stats #then they persist too", () => {
    // when / then
    const failed = transitionTaskRecord(runningRecord(), {
      type: "fail",
      timestamp: "t",
      error_message: "boom",
      run_stats: RUN_STATS,
    })
    expect(failed.record.run_stats).toEqual(RUN_STATS)

    const cancelled = transitionTaskRecord(runningRecord(), {
      type: "cancel",
      timestamp: "t",
      run_stats: RUN_STATS,
    })
    expect(cancelled.record.run_stats).toEqual(RUN_STATS)

    const interrupted = transitionTaskRecord(runningRecord(), {
      type: "interrupt",
      timestamp: "t",
      run_stats: RUN_STATS,
    })
    expect(interrupted.record.run_stats).toEqual(RUN_STATS)
  })

  test("#given a persisted record with run stats #when parsed #then the stats round-trip", () => {
    // given
    const record = { ...runningRecord({ status: "completed" }), run_stats: RUN_STATS }

    // when
    const parsed = parseTaskRecord(JSON.parse(JSON.stringify(record)), "/tmp/record.json")

    // then
    expect(parsed.run_stats).toEqual(RUN_STATS)
  })

  test("#given malformed run stats #when parsed #then parsing rejects the record", () => {
    // given
    const record = { ...runningRecord(), run_stats: { runtime_ms: "12" } }

    // then
    expect(() => parseTaskRecord(JSON.parse(JSON.stringify(record)), "/tmp/record.json")).toThrow()
  })
})
