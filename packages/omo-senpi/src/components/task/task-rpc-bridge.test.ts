import { describe, expect, it } from "bun:test"

import type { SessionShutdownEvent } from "@code-yeongyu/senpi"
import type { TaskRunStats } from "@oh-my-opencode/senpi-task"

import { taskRecord } from "./event-bridge.test-fixtures"
import { wireHarness } from "./event-bridge.test-harness"

describe("event-bridge native task telemetry and controls", () => {
  it("#given durable and live task facts #when session_start emits a snapshot #then RPC preserves every available fact without inventing fields", async () => {
    const completed = taskRecord({
      task_id: "st_completed",
      status: "completed",
      child_session_id: "child-session-completed",
      final_response: "Completed result",
      run_stats: {
        runtime_ms: 2_500,
        turns: 3,
        tool_calls: 4,
        output_tokens: 200,
        total_tokens: 1_200,
        generation_ms: 1_500,
        tokens_per_second: 133.3,
        cost_usd: 0.12,
        cache_hit_rate_last: 0.5,
        cache_hit_rate_run: 0.4,
      },
    })
    const failed = taskRecord({
      task_id: "st_failed",
      status: "error",
      child_session_id: "child-session-failed",
      error_message: "Child failed",
    })
    const running = taskRecord({
      task_id: "st_running",
      status: "running",
      child_session_id: "child-session-running",
    })
    const liveRunStats: TaskRunStats = {
      runtime_ms: 1_000,
      turns: 1,
      tool_calls: 2,
      output_tokens: 25,
      total_tokens: 125,
      generation_ms: 700,
      tokens_per_second: 35.7,
    }
    const { pi } = wireHarness("parent-session", {
      records: {
        [completed.task_id]: completed,
        [failed.task_id]: failed,
        [running.task_id]: running,
      },
      liveRunStats: { [running.task_id]: liveRunStats },
      withRpc: true,
    })

    await pi.dispatch("session_start", {}, {})

    const event = pi.rpcEvents.find((entry) => entry.name === "omo.task.updated")
    const tasks = (event?.data as { tasks?: Array<Record<string, unknown>> } | undefined)?.tasks ?? []
    expect(tasks.find((task) => task.task_id === completed.task_id)).toMatchObject({
      child_session_id: "child-session-completed",
      final_response: "Completed result",
      run_stats: completed.run_stats,
    })
    expect(tasks.find((task) => task.task_id === failed.task_id)).toMatchObject({
      child_session_id: "child-session-failed",
      error_message: "Child failed",
    })
    expect(tasks.find((task) => task.task_id === running.task_id)).toMatchObject({
      child_session_id: "child-session-running",
      run_stats: liveRunStats,
    })
  })

  it("#given a live child subscription #when tool progress arrives #then RPC emits one updated live_progress snapshot", async () => {
    const running = taskRecord({ task_id: "st_live", status: "running" })
    const { pi, emitChildEvent } = wireHarness("parent-session", {
      records: { [running.task_id]: running },
      withRpc: true,
    })
    await pi.dispatch("session_start", {}, {})
    const initialCount = pi.rpcEvents.length

    emitChildEvent(running.task_id, {
      type: "tool_execution_start",
      toolName: "read",
      args: { path: "src/task.ts" },
    })

    expect(pi.rpcEvents).toHaveLength(initialCount + 1)
    expect(pi.rpcEvents.at(-1)).toMatchObject({
      name: "omo.task.updated",
      data: {
        parent_session_id: "parent-session",
        tasks: [
          {
            task_id: "st_live",
            live_progress: {
              current_tool: expect.stringContaining("read"),
              turns: 0,
            },
          },
        ],
      },
    })
  })

  it("#given a modern Senpi RPC API #when the bridge wires #then output send and cancel handlers reuse session-scoped task semantics", async () => {
    const current = taskRecord({ task_id: "st_current", status: "running" })
    const foreign = taskRecord({
      task_id: "st_foreign",
      status: "running",
      parent_session_id: "other-session",
      root_session_id: "other-session",
    })
    const { pi, rpcHandlers, invokeRpc, sendCalls, cancelCalls } = wireHarness("parent-session", {
      records: { [current.task_id]: current, [foreign.task_id]: foreign },
      withRpc: true,
    })

    expect([...rpcHandlers.keys()].sort()).toEqual([
      "omo.task.cancel",
      "omo.task.output",
      "omo.task.send",
    ])
    await pi.dispatch("session_start", {}, {})

    await expect(
      invokeRpc("omo.task.send", {
        to: current.task_id,
        message: "UI steering received",
      }),
    ).resolves.toMatchObject({
      kind: "steered",
      task_id: current.task_id,
      status: "running",
    })
    expect(sendCalls).toEqual([
      {
        idOrName: current.task_id,
        message: "UI steering received",
        deliverAs: "steer",
        callerSessionId: "parent-session",
      },
    ])

    await expect(invokeRpc("omo.task.send", { to: current.task_id })).resolves.toMatchObject({
      kind: "invalid_arguments",
    })
    await expect(invokeRpc("omo.task.send", null)).resolves.toMatchObject({
      kind: "invalid_arguments",
    })
    await expect(
      invokeRpc("omo.task.output", {
        task_id: current.task_id,
        mode: "stream",
      }),
    ).resolves.toMatchObject({
      kind: "invalid_arguments",
    })
    await expect(
      invokeRpc("omo.task.cancel", {
        task_id: current.task_id,
        reason: 42,
      }),
    ).resolves.toMatchObject({
      kind: "invalid_arguments",
    })
    await expect(
      invokeRpc("omo.task.cancel", {
        task_id: foreign.task_id,
        reason: "wrong parent",
      }),
    ).resolves.toEqual({ kind: "not_found", reason: "Task not found." })
    expect(cancelCalls).toHaveLength(0)

    await expect(
      invokeRpc("omo.task.cancel", {
        task_id: current.task_id,
        reason: "Stop from panel",
      }),
    ).resolves.toMatchObject({
      kind: "cancelled",
      task_id: current.task_id,
    })
    expect(cancelCalls).toEqual([{ idOrName: current.task_id, reason: "Stop from panel" }])

    await expect(
      invokeRpc("omo.task.output", {
        task_id: current.task_id,
        mode: "status",
      }),
    ).resolves.toMatchObject({
      kind: "status",
      snapshot: {
        task_id: current.task_id,
        parent_session_id: "parent-session",
      },
    })
  })

  it("#given a live child subscription #when the task settles #then the bridge unsubscribes and ignores later child events", async () => {
    const running = taskRecord({ task_id: "st_settles", status: "running" })
    const { pi, records, emitStoreMutation, emitChildEvent, subscriberCount } = wireHarness("parent-session", {
      records: { [running.task_id]: running },
      withRpc: true,
    })
    await pi.dispatch("session_start", {}, {})
    expect(subscriberCount(running.task_id)).toBe(1)

    records[running.task_id] = taskRecord({
      ...running,
      status: "completed",
      final_response: "done",
    })
    emitStoreMutation()
    const settledEventCount = pi.rpcEvents.length

    expect(subscriberCount(running.task_id)).toBe(0)
    emitChildEvent(running.task_id, {
      type: "tool_execution_start",
      toolName: "read",
    })
    expect(pi.rpcEvents).toHaveLength(settledEventCount)
  })

  it("#given a live child subscription #when the session shuts down #then every task RPC listener is disposed", async () => {
    const running = taskRecord({ task_id: "st_shutdown", status: "running" })
    const { pi, subscriberCount } = wireHarness("parent-session", {
      records: { [running.task_id]: running },
      withRpc: true,
    })
    await pi.dispatch("session_start", {}, {})
    expect(subscriberCount(running.task_id)).toBe(1)

    await pi.dispatch(
      "session_shutdown",
      { type: "session_shutdown", reason: "quit" } as SessionShutdownEvent,
      {},
    )

    expect(subscriberCount(running.task_id)).toBe(0)
  })
})
