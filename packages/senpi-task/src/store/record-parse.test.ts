import { describe, expect, test } from "bun:test"

import type { TaskRecord, TaskRunStats } from "../state"
import { parseTaskRecord } from "./record-parse"

function persisted(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    task_id: "st_1a2b3c4d",
    status: "completed",
    residency_state: "resident",
    parent_session_id: "parent-session",
    root_session_id: "root-session",
    depth: 1,
    execution_mode: "in-process",
    model: "anthropic/claude-opus-4",
    notify_on_terminal: false,
    created_at: "2026-08-21T00:00:00.000Z",
    updated_at: "2026-08-21T00:01:00.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
    ...fields,
  }
}

describe("record-parse run_stats token totals", () => {
  test("#given a persisted run_stats without the new token fields #when parsed #then the record round-trips and the new fields stay undefined", () => {
    // given
    const legacy = persisted({
      run_stats: { runtime_ms: 5_000, turns: 2, tool_calls: 3, output_tokens: 120, total_tokens: 800 },
    })

    // when
    const record = parseTaskRecord(legacy, "record.json")

    // then
    expect(record.run_stats).toEqual({
      runtime_ms: 5_000,
      turns: 2,
      tool_calls: 3,
      output_tokens: 120,
      total_tokens: 800,
    })
    expect(record.run_stats?.input_tokens).toBeUndefined()
    expect(record.run_stats?.cache_read_tokens).toBeUndefined()
    expect(record.run_stats?.cache_write_tokens).toBeUndefined()
    expect(record.run_stats?.token_status).toBeUndefined()
    expect(record.run_stats?.cost_status).toBeUndefined()
    expect(record.run_stats?.duration_status).toBeUndefined()
    expect(record.task_seq).toBeUndefined()
    expect(record.config_generation).toBeUndefined()
    expect(record.background_mode).toBeUndefined()
  })

  test("#given a run_stats with all four token totals and status fields #when parsed #then every value round-trips exactly", () => {
    // given
    const runStats: TaskRunStats = {
      runtime_ms: 12_500,
      turns: 4,
      tool_calls: 9,
      input_tokens: 3_100,
      output_tokens: 2_200,
      cache_read_tokens: 41_000,
      cache_write_tokens: 7_700,
      total_tokens: 54_000,
      generation_ms: 8_400,
      tokens_per_second: 262,
      cost_usd: 0.42,
      cache_hit_rate_last: 0.91,
      cache_hit_rate_run: 0.84,
      token_status: "partial",
      cost_status: "reported",
      duration_status: "monotonic",
    }

    // when
    const record = parseTaskRecord(persisted({ run_stats: runStats }), "record.json")

    // then
    expect(record.run_stats).toEqual(runStats)
  })

  test("#given a run_stats carrying an unknown token_status #when parsed #then the record is rejected", () => {
    // given
    const rogue = persisted({
      run_stats: { runtime_ms: 1, turns: 1, tool_calls: 0, token_status: "mostly" },
    })

    // when / then
    expect(() => parseTaskRecord(rogue, "record.json")).toThrow(/token_status/)
  })

  test("#given a run_stats carrying non-numeric token totals #when parsed #then the record is rejected", () => {
    // given
    const rogue = persisted({
      run_stats: { runtime_ms: 1, turns: 1, tool_calls: 0, cache_write_tokens: "many" },
    })

    // when / then
    expect(() => parseTaskRecord(rogue, "record.json")).toThrow(/cache_write_tokens/)
  })
})

describe("record-parse task ordinals and background mode", () => {
  test("#given a persisted record with task_seq, config_generation and background_mode #when parsed #then all three round-trip exactly", () => {
    // given
    const stored = persisted({ task_seq: 7, config_generation: 3, background_mode: "promoted" })

    // when
    const record: TaskRecord = parseTaskRecord(stored, "record.json")

    // then
    expect(record.task_seq).toBe(7)
    expect(record.config_generation).toBe(3)
    expect(record.background_mode).toBe("promoted")
  })

  test("#given a persisted record with an unknown background_mode #when parsed #then the record is rejected", () => {
    // given
    const stored = persisted({ background_mode: "detached" })

    // when / then
    expect(() => parseTaskRecord(stored, "record.json")).toThrow(/background_mode/)
  })
})
