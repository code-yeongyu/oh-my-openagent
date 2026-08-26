import { describe, expect, test } from "bun:test"

import type { TaskRecord, TaskRunStats } from "@oh-my-opencode/senpi-task"
import type { DagNodeId, DagRunId } from "@oh-my-opencode/senpi-task/dag"

// DagRunId/DagNodeId are branded strings with no runtime constructor; the repo's dag tests build
// fixtures the same way (see components/task/dag-runtime.test.ts).
const DAG_RUN_ID = "dag-1" as DagRunId
const DAG_NODE_ID = "node-1" as DagNodeId

import { projectDelegationCompleted } from "./delegation-projection"
import { OMO_NATIVE_PROPERTY_ALLOWLISTS } from "./product-identity"

function record(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: "st_0001",
    status: "completed",
    residency_state: "resident",
    created_at: "2026-08-21T00:00:00.000Z",
    updated_at: "2026-08-21T00:01:00.000Z",
    parent_session_id: "parent-session",
    root_session_id: "parent-session",
    depth: 0,
    execution_mode: "in-process",
    model: "anthropic/claude-opus-5",
    notify_on_terminal: false,
    notification: { run_epoch: 0, notified_epoch: -1 },
    task_seq: 3,
    background_mode: "foreground",
    category: "deep",
    config_generation: 2,
    spawn_spec: { version: 1, cwd: "/repo", prompt: "do the work" },
    resolved_model: {
      provider: "anthropic",
      model_id: "claude-opus-5",
      display: "Claude Opus 5",
      reasoning: "high",
      source: "category",
    },
    run_stats: {
      runtime_ms: 1_234,
      turns: 4,
      tool_calls: 9,
      duration_status: "monotonic",
      token_status: "complete",
      cost_status: "reported",
      input_tokens: 100,
      output_tokens: 20,
      cache_read_tokens: 30,
      cache_write_tokens: 40,
      total_tokens: 190,
      cost_usd: 0.5,
    },
    ...overrides,
  }
}

function project(input: {
  readonly record?: Partial<TaskRecord>
  readonly counters?: { readonly running: number; readonly queued: number }
  readonly previousStatus?: TaskRecord["status"]
  readonly startReason?: Parameters<typeof projectDelegationCompleted>[0]["startReason"]
}): Readonly<Record<string, string | number | boolean>> {
  return projectDelegationCompleted({
    edge: {
      record: record(input.record ?? {}),
      ...(input.previousStatus === undefined ? {} : { previousStatus: input.previousStatus }),
    },
    sessionHash: "hashed-parent",
    steerCounts: input.counters ?? { running: 0, queued: 0 },
    startReason: input.startReason ?? "initial_spawn",
  })
}

describe("delegation_completed projection", () => {
  test("#given a TaskRecord carrying final_response, error_message, name, description and continuation_hint #when projected #then the property key set equals the delegation_completed allowlist exactly and no free text appears in the serialized payload", () => {
    // given: a record stuffed with every free-text field the state machine can persist
    const secret = "PROPRIETARY-PLAN-TEXT"
    const props = project({
      record: {
        name: `name ${secret}`,
        description: `description ${secret}`,
        task_summary: `summary ${secret}`,
        final_response: `final ${secret}`,
        error_message: `error ${secret}`,
        spawn_spec: { version: 1, cwd: `/repo/${secret}`, prompt: `prompt ${secret}` },
      },
    })

    // when: the payload is serialized exactly as the transport would see it
    const serialized = JSON.stringify(props)

    // then: nothing outside the declared allowlist ships, and no free text leaked
    expect(Object.keys(props).sort()).toEqual([...OMO_NATIVE_PROPERTY_ALLOWLISTS.delegation_completed].sort())
    expect(serialized).not.toContain(secret)
    for (const value of Object.values(props)) {
      if (typeof value === "string") expect(value.length).toBeLessThanOrEqual(64)
      if (typeof value === "number") expect(Number.isFinite(value)).toBe(true)
    }
  })

  test("#given a terminal record on a known provider #when projected #then identity, shape and stats fields carry the record's values", () => {
    // given / when
    const props = project({ counters: { running: 2, queued: 1 } })

    // then
    expect(props).toMatchObject({
      $session_id: "hashed-parent",
      task_seq: 3,
      run_epoch: 0,
      status: "completed",
      start_reason: "initial_spawn",
      category: "deep",
      agent_type: "none",
      owner_kind: "plain_child",
      background_mode: "foreground",
      execution_mode: "in-process",
      provider: "anthropic",
      model_id: "claude-opus-5",
      reasoning_effort: "high",
      model_source: "category",
      fallback_attempts: 0,
      config_generation: 2,
      duration_ms: 1_234,
      duration_status: "monotonic",
      turns: 4,
      tool_calls: 9,
      input_tokens: 100,
      output_tokens: 20,
      cache_read_tokens: 30,
      cache_write_tokens: 40,
      total_tokens: 190,
      token_status: "complete",
      cost_usd: 0.5,
      cost_status: "reported",
      stats_status: "complete",
      task_send_running_count: 2,
      task_send_queued_count: 1,
    })
  })

  test("#given a publicly known model on an unknown provider #when projected #then the provider is \"custom\" while the model id survives", () => {
    // given / when: a shipped model routed through a user-named gateway
    const props = project({
      record: {
        resolved_model: {
          provider: "my-gateway",
          model_id: "claude-opus-5",
          display: "Custom",
          reasoning: "medium",
          source: "explicit",
        },
      },
    })

    // then: the user-authored gateway name is withheld, the public product name is exported
    expect(props.provider).toBe("custom")
    expect(props.model_id).toBe("claude-opus-5")
    expect(props.model_source).toBe("explicit")
  })

  test("#given a privately named model on an unknown provider #when projected #then provider and model_id are both \"custom\"", () => {
    // given / when: a fine-tune the user named themselves
    const props = project({
      record: {
        resolved_model: {
          provider: "my-gateway",
          model_id: "acme-internal-ft",
          display: "Custom",
          reasoning: "medium",
          source: "explicit",
        },
      },
    })

    // then: neither half leaves the machine
    expect(props.provider).toBe("custom")
    expect(props.model_id).toBe("custom")
    expect(props.model_source).toBe("explicit")
  })

  test("#given a record whose run_stats has no cost #when projected #then cost_usd is absent and cost_status is \"unavailable\", and #given a reported zero cost #then cost_usd is 0 with cost_status \"reported\"", () => {
    // given: usage without any provider-reported cost
    const withoutCost: TaskRunStats = {
      runtime_ms: 10,
      turns: 1,
      tool_calls: 0,
      duration_status: "monotonic",
      token_status: "partial",
      cost_status: "unavailable",
    }

    // when
    const absent = project({ record: { run_stats: withoutCost } })
    const zero = project({
      record: { run_stats: { ...withoutCost, cost_status: "reported", cost_usd: 0 } },
    })

    // then
    expect(absent).not.toHaveProperty("cost_usd")
    expect(absent.cost_status).toBe("unavailable")
    expect(absent.token_status).toBe("partial")
    expect(absent).not.toHaveProperty("input_tokens")
    expect(zero.cost_usd).toBe(0)
    expect(zero.cost_status).toBe("reported")
  })

  test("#given a record reconciled to lost with no run_stats #when projected #then stats are unavailable and the duration falls back to wall clock", () => {
    // given / when
    const props = project({
      record: {
        status: "lost",
        run_stats: undefined,
        created_at: "2026-08-21T00:00:00.000Z",
        updated_at: "2026-08-21T00:00:05.000Z",
      },
      previousStatus: "running",
    })

    // then
    expect(props.status).toBe("lost")
    expect(props.stats_status).toBe("unavailable")
    expect(props.duration_status).toBe("wall_clock")
    expect(props.duration_ms).toBe(5_000)
    expect(props.token_status).toBe("unavailable")
    expect(props.cost_status).toBe("unavailable")
    expect(props).not.toHaveProperty("cost_usd")
  })

  test("#given a backwards wall clock and no stats #when projected #then the duration is unavailable rather than negative", () => {
    // given / when
    const props = project({
      record: {
        status: "lost",
        run_stats: undefined,
        created_at: "2026-08-21T00:00:10.000Z",
        updated_at: "2026-08-21T00:00:05.000Z",
      },
    })

    // then
    expect(props.duration_status).toBe("unavailable")
    expect(props.duration_ms).toBe(0)
  })

  test("#given dag-owned and team-member records #when projected #then owner_kind separates them from plain children", () => {
    // given / when
    const dag = project({
      record: { owner: { kind: "dag", runId: DAG_RUN_ID, nodeId: DAG_NODE_ID, fingerprint: "fp" } },
      startReason: "dag_retry",
    })
    const member = project({
      record: {
        spawn_spec: { version: 1, cwd: "/repo", prompt: "work", member_scoped_tool_names: ["task_send"] },
      },
    })
    const unprovable = project({ record: { spawn_spec: undefined } })

    // then
    expect(dag.owner_kind).toBe("dag_node")
    expect(dag.start_reason).toBe("dag_retry")
    expect(member.owner_kind).toBe("team_member")
    expect(unprovable.owner_kind).toBe("unknown")
  })

  test("#given a custom category, custom agent and absent ordinals #when projected #then closed vocabularies and safe defaults are used", () => {
    // given / when
    const props = project({
      record: {
        category: "my-private-category",
        agent_type: "my-private-agent",
        task_seq: undefined,
        config_generation: undefined,
        background_mode: undefined,
        fallback_attempts: [
          { provider: "anthropic", model_id: "claude-opus-5", display: "a", source: "category" },
          { provider: "openai", model_id: "gpt-5.6-sol", display: "b", source: "category" },
        ],
        resolved_model: {
          provider: "openai",
          model_id: "gpt-5.6-sol",
          display: "GPT",
          reasoning: "harness-preset-42",
          source: "agent",
        },
      },
    })

    // then
    expect(props.category).toBe("custom")
    expect(props.agent_type).toBe("custom")
    expect(props.task_seq).toBe(0)
    expect(props.config_generation).toBe(0)
    expect(props.background_mode).toBe("unknown")
    expect(props.fallback_attempts).toBe(2)
    expect(props.reasoning_effort).toBe("other")
  })

  test("#given a record with no category and no agent #when projected #then both read none", () => {
    // given / when
    const props = project({ record: { category: undefined, agent_type: undefined } })

    // then
    expect(props.category).toBe("none")
    expect(props.agent_type).toBe("none")
    expect(props.reasoning_effort).toBe("high")
  })
})
