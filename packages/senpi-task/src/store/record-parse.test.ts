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

describe("record-parse launch evidence", () => {
  test("isolation and v1 isolation preserve Windows paths through JSON", () => {
    const isolation = { backend: "rcopy", merged_dir: "C:\\clone\\child", base_dir: "C:\\base\\repo", mode: "branch", apply: false } as const
    const spawnSpec = { version: 1, cwd: "C:\\clone\\child", prompt: "Inspect", isolation } as const
    const stored = persisted({
      isolation,
      spawn_spec: spawnSpec,
    })
    const parsed = parseTaskRecord(JSON.parse(JSON.stringify(stored)), "record.json")
    expect(parsed.isolation).toEqual(isolation)
    expect(parsed.spawn_spec).toEqual(spawnSpec)
  })

  test("legacy records omit isolation", () => {
    expect(parseTaskRecord(persisted({}), "record.json")).not.toHaveProperty("isolation")
  })

  test("settled isolation merge results round-trip without changing artifact paths", () => {
    const isolation = {
      backend: "apfs", merged_dir: "/clone", base_dir: "/base", mode: "patch", apply: true,
      merge_result: { kind: "not-applied", changesApplied: false, duration_ms: 13, patchPath: "C:\\artifacts\\root.patch", error: "conflict" },
    } as const
    expect(parseTaskRecord(JSON.parse(JSON.stringify(persisted({ isolation }))), "record.json").isolation)
      .toEqual(isolation)
  })

  test.each([
    { backend: "projfs" }, { apply: "yes" }, { mode: "squash" }, { merged_dir: 123 },
  ])("malformed isolation is rejected", (override) => {
    const isolation = { backend: "rcopy", merged_dir: "/clone", base_dir: "/base", mode: "patch", apply: true, ...override }
    expect(() => parseTaskRecord(persisted({ isolation }), "record.json")).toThrow()
    expect(() => parseTaskRecord(persisted({ spawn_spec: { version: 1, cwd: "/clone", prompt: "Inspect", isolation } }), "record.json")).toThrow()
  })

  test("#given a lost record with started_at #when persisted JSON is parsed #then the task-level launch evidence round-trips", () => {
    const startedAt = "2026-08-21T00:00:01.000Z"
    const stored = persisted({ status: "lost", started_at: startedAt })
    const parsed = parseTaskRecord(JSON.parse(JSON.stringify(stored)), "record.json")
    expect(parsed).toMatchObject({ status: "lost", started_at: startedAt })
  })

  test.each(["pending", "running", "lost"])("#given a legacy %s record without started_at #when parsed #then it stays readable without inventing launch evidence", (status) => {
    const parsed = parseTaskRecord(persisted({ status }), "record.json")
    expect(parsed.status).toBe(status)
    expect(parsed).not.toHaveProperty("started_at")
  })

  test.each([123, null])("#given malformed started_at %s #when parsed #then the persisted record is rejected", (startedAt) => {
    expect(() => parseTaskRecord(persisted({ started_at: startedAt }), "record.json")).toThrow(/started_at/)
  })
})

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

  // A failed turn is recorded as `failed_turns`, never as a `turn`. The parser has to READ it back:
  // dropping it silently turns every persisted failure count into zero on the next read, so
  // task_output and the completion notification lose the only evidence that attempts were made.
  test("#given a persisted run_stats carrying failed_turns #when parsed #then the failure count round-trips", () => {
    // given
    const runStats: TaskRunStats = {
      runtime_ms: 61_062,
      turns: 0,
      failed_turns: 6,
      tool_calls: 0,
      token_status: "unavailable",
      cost_status: "unavailable",
      duration_status: "monotonic",
    }

    // when
    const record = parseTaskRecord(persisted({ run_stats: runStats }), "record.json")

    // then
    expect(record.run_stats?.failed_turns).toBe(6)
    expect(record.run_stats).toEqual(runStats)
  })

  test("#given a persisted run_stats without failed_turns #when parsed #then the field stays undefined", () => {
    // given
    const legacy = persisted({ run_stats: { runtime_ms: 5_000, turns: 2, tool_calls: 3 } })

    // when
    const record = parseTaskRecord(legacy, "record.json")

    // then
    expect(record.run_stats?.failed_turns).toBeUndefined()
  })

  test("#given a run_stats carrying a non-numeric failed_turns #when parsed #then the record is rejected", () => {
    // given
    const rogue = persisted({ run_stats: { runtime_ms: 1, turns: 1, tool_calls: 0, failed_turns: "many" } })

    // when / then
    expect(() => parseTaskRecord(rogue, "record.json")).toThrow()
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

describe("record-parse child_session_id", () => {
  test("#given a persisted record with child_session_id #when parsed #then the field round-trips", () => {
    // given
    const stored = persisted({ child_session_id: "01a0815e-3d9d-743a-8a5a-3a443aeb8f70" })

    // when
    const record = parseTaskRecord(stored, "record.json")

    // then
    expect(record.child_session_id).toBe("01a0815e-3d9d-743a-8a5a-3a443aeb8f70")
  })

  test("#given a legacy record without child_session_id #when parsed #then the record still loads", () => {
    // given a record written before the field was persisted
    const stored = persisted({})

    // when
    const record = parseTaskRecord(stored, "record.json")

    // then the optional field stays absent rather than being invented or rejected
    expect(record.task_id).toBe("st_1a2b3c4d")
    expect(record.child_session_id).toBeUndefined()
    expect("child_session_id" in record).toBe(false)
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

describe("record-parse runner_kind and host_session fields", () => {
  test("#given a persisted record with runner_kind and host_session #when parsed #then both fields round-trip exactly", () => {
    // given
    const stored = persisted({
      runner_kind: "host-session",
      host_session: {
        socket: "/tmp/omo-agent/rpc/rpc.sock",
        routing_id: "routing-12345",
        session_path: "01a0815e-session-path",
        instance_id: "inst-uuid-001",
        daemon_pid: 54321,
      },
    })

    // when
    const record = parseTaskRecord(stored, "record.json")

    // then
    expect(record.runner_kind).toBe("host-session")
    expect(record.host_session).toEqual({
      socket: "/tmp/omo-agent/rpc/rpc.sock",
      routing_id: "routing-12345",
      session_path: "01a0815e-session-path",
      instance_id: "inst-uuid-001",
      daemon_pid: 54321,
    })
  })

  test("#given a legacy record without runner_kind and host_session #when parsed #then the record still loads", () => {
    // given
    const stored = persisted({})

    // when
    const record = parseTaskRecord(stored, "record.json")

    // then
    expect(record.runner_kind).toBeUndefined()
    expect(record.host_session).toBeUndefined()
    expect("runner_kind" in record).toBe(false)
    expect("host_session" in record).toBe(false)
  })

  test("#given a record with runner_kind='child-process' #when parsed #then it round-trips", () => {
    // given
    const stored = persisted({ runner_kind: "child-process" })

    // when
    const record = parseTaskRecord(stored, "record.json")

    // then
    expect(record.runner_kind).toBe("child-process")
    expect(record.host_session).toBeUndefined()
  })

  test("#given a record with malformed host_session (missing routing_id) #when parsed #then a typed error is thrown", () => {
    // given
    const stored = persisted({
      runner_kind: "host-session",
      host_session: {
        socket: "/tmp/omo-agent/rpc/rpc.sock",
        session_path: "01a0815e-session-path",
        instance_id: "inst-uuid-001",
        // routing_id is missing - should cause an error
      },
    })

    // when / then - expect a typed parse error, not silent coercion
    expect(() => parseTaskRecord(stored, "record.json")).toThrow(/routing_id/)
  })

  test("#given a record with host_session but no runner_kind #when parsed #then an error is thrown", () => {
    // given - inconsistent: host_session present but runner_kind not set to host-session
    const stored = persisted({
      host_session: {
        socket: "/tmp/omo-agent/rpc/rpc.sock",
        routing_id: "routing-12345",
        session_path: "01a0815e-session-path",
        instance_id: "inst-uuid-001",
      },
    })

    // when / then
    expect(() => parseTaskRecord(stored, "record.json")).toThrow()
  })

  test("#given a record with host_session containing a non-numeric daemon_pid #when parsed #then an error is thrown", () => {
    // given
    const stored = persisted({
      runner_kind: "host-session",
      host_session: {
        socket: "/tmp/omo-agent/rpc/rpc.sock",
        routing_id: "routing-12345",
        session_path: "01a0815e-session-path",
        instance_id: "inst-uuid-001",
        daemon_pid: "not-a-number",
      },
    })

    // when / then
    expect(() => parseTaskRecord(stored, "record.json")).toThrow(/daemon_pid/)
  })
})
