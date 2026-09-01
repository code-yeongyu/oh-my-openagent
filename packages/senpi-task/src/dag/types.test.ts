import { describe, expect, expectTypeOf, test } from "bun:test"

import type { TaskTargetErrorCode } from "../tools/task/validation"
import {
  DAG_ACTIVITY_CHANNEL,
  DAG_EVENT_LANES,
  DAG_NODE_ERROR_CODES,
  DAG_NODE_STATES,
  DAG_NODE_TRANSITION_REASONS,
  DAG_ROUTE_KINDS,
  DAG_RUN_EVENT_TYPES,
  DAG_RUN_STATUSES,
  DAG_SETTINGS_DEFAULTS,
} from "./types"
import type {
  DagActivityEvent,
  DagNodeTargetInput,
  DagNodeTransitionReason,
  DagRunEvent,
  DagRunEventEnvelope,
  DagRunEventPayload,
  DagRoute,
} from "./types"

const EXPECTED_JOURNALED_EVENT_TYPES = [
  "dag.run.created",
  "dag.run.started",
  "dag.run.paused",
  "dag.run.resumed",
  "dag.run.completed",
  "dag.run.failed",
  "dag.run.cancelled",
  "dag.wave.started",
  "dag.wave.completed",
  "dag.node.transitioned",
  "dag.node.task-attached",
  "dag.node.reused",
  "dag.node.retried",
  "dag.node.steered",
  "dag.definition.amended",
  "dag.diagnostic.added",
  "dag.stream.overflow",
] as const

describe("dag domain types", () => {
  test("#given the journaled payload union #when its type tags are enumerated #then it has exactly 14 members and excludes live activity", () => {
    // given / when
    const tags = [...DAG_RUN_EVENT_TYPES]

    // then
    expect(tags).toHaveLength(17)
    expect([...tags].sort()).toEqual([...EXPECTED_JOURNALED_EVENT_TYPES].sort())
    expect(tags).not.toContain("dag.node.activity")
    expectTypeOf<DagRunEventPayload["type"]>().toEqualTypeOf<(typeof DAG_RUN_EVENT_TYPES)[number]>()
  })

  test("#given a journaled dag event #when constructed #then type and seq are sibling top-level properties on the flat envelope-payload intersection", () => {
    // given
    const event: DagRunEvent = {
      schemaVersion: 1,
      runId: "run-1" as DagRunEvent["runId"],
      seq: 7,
      at: "2026-08-14T00:00:00.000Z",
      lane: "boundary",
      type: "dag.run.started",
      generation: 1,
    }

    // when
    const keys = Object.keys(event)

    // then
    expect(keys).toContain("type")
    expect(keys).toContain("seq")
    expect(event.type).toBe("dag.run.started")
    expect(event.seq).toBe(7)
    expect(event.schemaVersion).toBe(1)
    expect([...DAG_EVENT_LANES].sort()).toEqual(["activity", "boundary"])
    expectTypeOf<DagRunEvent>().toEqualTypeOf<DagRunEventEnvelope & DagRunEventPayload>()
    expectTypeOf<DagRunEventEnvelope>().not.toHaveProperty("payload")
  })

  test("#given live activity telemetry #when inspected #then it is a separate unsequenced event on its own channel", () => {
    // given
    const activity: DagActivityEvent = {
      schemaVersion: 1,
      runId: "run-1" as DagActivityEvent["runId"],
      nodeId: "n-1" as DagActivityEvent["nodeId"],
      taskId: "task-1",
      at: "2026-08-14T00:00:00.000Z",
      activity: "streaming",
      currentTool: "bash",
      lastAssistantLine: "working",
      turns: 3,
      toolCalls: 5,
    }

    // when / then
    expect(DAG_ACTIVITY_CHANNEL).toBe("omo.dag.activity")
    expect("seq" in activity).toBe(false)
    expectTypeOf<DagActivityEvent>().not.toHaveProperty("seq")
    expectTypeOf<DagActivityEvent>().not.toHaveProperty("payload")
  })

  test("#given a dag route #when kinds are enumerated #then category XOR agent holds and a pure model route is impossible", () => {
    // given
    const categoryRoute: DagRoute = { kind: "category", category: "quick" }
    const agentRoute: DagRoute = { kind: "agent", agent: "momus", model: "openai/gpt-5" }

    // when / then
    expect(categoryRoute.kind).toBe("category")
    expect(agentRoute.model).toBe("openai/gpt-5")
    expect(DAG_ROUTE_KINDS).not.toContain("model")
    expectTypeOf<DagRoute["kind"]>().toEqualTypeOf<"category" | "agent">()
    expectTypeOf<Extract<DagRoute, { kind: "model" }>>().toBeNever()
    expectTypeOf<Extract<DagRoute, { kind: "category" }>>().not.toHaveProperty("model")
    expectTypeOf<Extract<DagRoute, { kind: "agent" }>["model"]>().toEqualTypeOf<string | undefined>()
  })

  test("#given node-level user input #when field names are checked #then they mirror the task tool category XOR subagent_type contract", () => {
    // given
    const byCategory: DagNodeTargetInput = { category: "quick", prompt: "do it" }
    const bySubagent: DagNodeTargetInput = {
      subagent_type: "momus",
      model: "openai/gpt-5",
      prompt: "do it",
    }

    // when / then
    expect(byCategory.category).toBe("quick")
    expect(bySubagent.subagent_type).toBe("momus")
    expectTypeOf<Extract<DagNodeTargetInput, { category: string }>["subagent_type"]>().toEqualTypeOf<
      undefined
    >()
    expectTypeOf<Extract<DagNodeTargetInput, { category: string }>["model"]>().toEqualTypeOf<
      undefined
    >()
    expectTypeOf<
      Extract<DagNodeTargetInput, { subagent_type: string }>["category"]
    >().toEqualTypeOf<undefined>()
    expectTypeOf<
      Extract<DagNodeTargetInput, { subagent_type: string }>["model"]
    >().toEqualTypeOf<string | undefined>()
    expectTypeOf<
      import("./types").DagNodeTargetErrorCode
    >().toEqualTypeOf<TaskTargetErrorCode>()
  })

  test("#given the settings block #when defaults resolve #then every documented default holds", () => {
    // given / when / then
    expect(DAG_SETTINGS_DEFAULTS).toEqual({
      max_nodes_per_run: 64,
      max_runs_per_session: 16,
      subscriber_ring: 1000,
      heartbeat_ms: 15000,
      history_default_limit: 256,
      history_max_limit: 1000,
      retention_days: 7,
      max_prompt_bytes: 262144,
    })
  })

  test("#given the state vocabularies #when enumerated #then run statuses node states error codes and transition reasons match the contract", () => {
    // given / when / then
    expect([...DAG_RUN_STATUSES]).toEqual([
      "pending",
      "running",
      "paused",
      "completed",
      "failed",
      "cancelled",
    ])
    expect([...DAG_NODE_STATES]).toEqual([
      "pending",
      "blocked",
      "scheduled",
      "running",
      "completed",
      "failed",
      "cancelled",
      "skipped",
    ])
    expect([...DAG_NODE_ERROR_CODES]).toEqual([
      "plan_unresolved",
      "depth_denied",
      "start_failed",
      "residency_denied",
      "task_error",
      "task_interrupted",
      "task_lost",
      "task_cancelled",
      "resume_task_missing",
      "journal_corrupt",
    ])
    expect(DAG_NODE_TRANSITION_REASONS).toEqual([
      { kind: "unblocked" },
      { kind: "scheduled" },
      { kind: "started" },
      { kind: "succeeded" },
      { kind: "failed" },
      { kind: "cancelled" },
      { kind: "skipped" },
      { kind: "interrupted" },
      { kind: "lost" },
      { kind: "resumed" },
      { kind: "retried" },
      { kind: "amend_invalidated" },
      { kind: "revived" },
    ])
    const queued: DagNodeTransitionReason = { kind: "task_queued", queuePosition: 3 }
    expect(queued).toEqual({ kind: "task_queued", queuePosition: 3 })
  })
})
