import { describe, expect, it } from "bun:test"

import type { SessionShutdownEvent } from "@code-yeongyu/senpi"

import { taskRecord } from "./event-bridge.test-fixtures"
import { wireHarness } from "./event-bridge.test-harness"

describe("event-bridge task RPC security and bounds", () => {
  it("#given a terminal record and a retained live tracker #when a snapshot emits #then durable terminal stats win", async () => {
    const completed = taskRecord({
      task_id: "st_terminal_stats",
      status: "completed",
      run_stats: {
        runtime_ms: 500,
        turns: 1,
        tool_calls: 2,
      },
    })
    const { pi } = wireHarness("parent-session", {
      records: { [completed.task_id]: completed },
      liveRunStats: {
        [completed.task_id]: {
          runtime_ms: 4_000,
          turns: 1,
          tool_calls: 2,
        },
      },
      withRpc: true,
    })

    await pi.dispatch("session_start", {}, {})

    expect(pi.rpcEvents[0]).toMatchObject({
      data: {
        tasks: [
          {
            task_id: completed.task_id,
            run_stats: {
              runtime_ms: 500,
              turns: 1,
              tool_calls: 2,
            },
          },
        ],
      },
    })
  })

  it("#given foreign and absent task ids #when controls run #then every response is the same generic not-found result", async () => {
    const current = taskRecord({ task_id: "st_current_scope", status: "running" })
    const foreign = taskRecord({
      task_id: "st_foreign_scope",
      name: "st_foreign_name",
      status: "running",
      parent_session_id: "secret-session",
      root_session_id: "secret-session",
    })
    const { pi, invokeRpc, sendCalls, cancelCalls } = wireHarness("parent-session", {
      records: { [current.task_id]: current, [foreign.task_id]: foreign },
      withRpc: true,
    })
    await pi.dispatch("session_start", {}, {})

    await expect(
      invokeRpc("omo.task.cancel", {
        task_id: foreign.task_id,
      }),
    ).resolves.toEqual({
      kind: "not_found",
      reason: "Task not found.",
    })
    expect(cancelCalls).toHaveLength(0)

    await expect(
      invokeRpc("omo.task.send", {
        to: foreign.task_id,
        message: "cross-session",
      }),
    ).resolves.toEqual({
      kind: "not_found",
      reason: "Task not found.",
    })
    await expect(
      invokeRpc("omo.task.send", {
        to: "st_absent_scope",
        message: "absent",
      }),
    ).resolves.toEqual({
      kind: "not_found",
      reason: "Task not found.",
    })
    await expect(
      invokeRpc("omo.task.output", {
        task_id: foreign.task_id,
        mode: "status",
      }),
    ).resolves.toEqual({
      kind: "not_found",
      reason: "Task not found.",
    })
    expect(sendCalls).toHaveLength(0)
  })

  it("#given no attached parent session #when any task control runs #then every handler fails closed", async () => {
    const task = taskRecord({ task_id: "st_unattached", status: "running" })
    const { invokeRpc, sendCalls, cancelCalls } = wireHarness(undefined, {
      records: { [task.task_id]: task },
      withRpc: true,
    })

    await expect(
      invokeRpc("omo.task.send", {
        to: task.task_id,
        message: "should not send",
      }),
    ).resolves.toMatchObject({ kind: "unavailable" })
    await expect(
      invokeRpc("omo.task.cancel", {
        task_id: task.task_id,
      }),
    ).resolves.toMatchObject({ kind: "unavailable" })
    await expect(
      invokeRpc("omo.task.output", {
        task_id: task.task_id,
        mode: "status",
      }),
    ).resolves.toMatchObject({ kind: "unavailable" })
    expect(sendCalls).toHaveLength(0)
    expect(cancelCalls).toHaveLength(0)
  })

  it("#given oversized controls snapshots and status output #when RPC handles them #then every boundary rejects or truncates explicitly", async () => {
    const tasks = Object.fromEntries(
      Array.from({ length: 260 }, (_, index) => {
        const task = taskRecord({
          task_id: `st_bounded_${index}`,
          status: index === 0 ? "running" : "completed",
          description: index === 259 ? "d".repeat(32_001) : undefined,
          final_response: index === 259 ? "r".repeat(32_001) : `result-${index}`,
          error_message: index === 258 ? "e".repeat(32_001) : undefined,
        })
        return [task.task_id, task]
      }),
    )
    const { pi, invokeRpc } = wireHarness("parent-session", {
      records: tasks,
      withRpc: true,
    })
    await pi.dispatch("session_start", {}, {})

    await expect(
      invokeRpc("omo.task.send", {
        to: "st_bounded_0",
        message: "m".repeat(32_001),
      }),
    ).resolves.toMatchObject({ kind: "invalid_arguments" })
    const oversizedTaskId = `st_${"i".repeat(255)}`
    await expect(
      invokeRpc("omo.task.send", {
        to: oversizedTaskId,
        message: "bounded id",
      }),
    ).resolves.toMatchObject({ kind: "invalid_arguments" })
    await expect(
      invokeRpc("omo.task.output", {
        task_id: oversizedTaskId,
        mode: "status",
      }),
    ).resolves.toMatchObject({ kind: "invalid_arguments" })
    await expect(
      invokeRpc("omo.task.cancel", {
        task_id: "st_bounded_0",
        reason: "x".repeat(2_001),
      }),
    ).resolves.toMatchObject({ kind: "invalid_arguments" })

    const payload = pi.rpcEvents[0]?.data as {
      tasks: Array<Record<string, unknown>>
      truncated_tasks?: number
    }
    expect(payload.tasks).toHaveLength(256)
    expect(payload.truncated_tasks).toBe(4)
    expect(payload.tasks.some((task) => task.task_id === "st_bounded_0")).toBe(true)
    const boundedResult = payload.tasks.find((task) => task.task_id === "st_bounded_259")
    const boundedError = payload.tasks.find((task) => task.task_id === "st_bounded_258")
    expect(String(boundedResult?.final_response)).toHaveLength(32_000)
    expect(boundedResult?.final_response_truncated).toBe(true)
    expect(String(boundedResult?.description)).toHaveLength(32_000)
    expect(boundedResult?.description_truncated).toBe(true)
    expect(String(boundedError?.error_message)).toHaveLength(32_000)
    expect(boundedError?.error_message_truncated).toBe(true)
    await expect(
      invokeRpc("omo.task.output", {
        task_id: "st_bounded_259",
        mode: "status",
      }),
    ).resolves.toMatchObject({
      kind: "status",
      snapshot: {
        final_response: "r".repeat(32_000),
        final_response_truncated: true,
        description: "d".repeat(32_000),
        description_truncated: true,
      },
    })
  })

  it("#given more live tasks than the snapshot cap #when RPC emits #then only the newest live rows are retained", async () => {
    const tasks = Object.fromEntries(
      Array.from({ length: 260 }, (_, index) => {
        const task = taskRecord({ task_id: `st_live_cap_${index}`, status: "running" })
        return [task.task_id, task]
      }),
    )
    const { pi } = wireHarness("parent-session", { records: tasks, withRpc: true })

    await pi.dispatch("session_start", {}, {})

    const payload = pi.rpcEvents[0]?.data as { tasks: Array<Record<string, unknown>>; truncated_tasks?: number }
    expect(payload.tasks).toHaveLength(256)
    expect(payload.truncated_tasks).toBe(4)
    expect(payload.tasks[0]?.task_id).toBe("st_live_cap_4")
  })

  it("#given a live child and registered controls #when the session switches or shuts down #then old listeners and handlers are fenced", async () => {
    const running = taskRecord({ task_id: "st_lifetime", status: "running" })
    const { pi, invokeRpc, emitStoreMutation, emitChildEvent, subscriberCount, sendCalls } = wireHarness(
      "parent-session",
      {
        records: { [running.task_id]: running },
        withRpc: true,
      },
    )
    await pi.dispatch("session_start", {}, {})
    expect(subscriberCount(running.task_id)).toBe(1)

    await pi.dispatch("session_before_switch", {}, {})
    const switchedEventCount = pi.rpcEvents.length
    expect(subscriberCount(running.task_id)).toBe(0)
    emitStoreMutation()
    expect(subscriberCount(running.task_id)).toBe(0)
    emitChildEvent(running.task_id, {
      type: "tool_execution_start",
      toolName: "read",
    })
    expect(pi.rpcEvents).toHaveLength(switchedEventCount)
    await expect(
      invokeRpc("omo.task.send", {
        to: running.task_id,
        message: "after switch",
      }),
    ).resolves.toMatchObject({ kind: "unavailable" })

    await pi.dispatch(
      "session_shutdown",
      { type: "session_shutdown", reason: "quit" } as SessionShutdownEvent,
      {},
    )
    await expect(
      invokeRpc("omo.task.send", {
        to: running.task_id,
        message: "after shutdown",
      }),
    ).resolves.toMatchObject({ kind: "unavailable" })
    expect(sendCalls).toHaveLength(0)
  })
})
