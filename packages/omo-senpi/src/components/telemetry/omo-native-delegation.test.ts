import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { EventTelemetryProperties } from "@oh-my-opencode/telemetry-core"
import type { TaskRecord } from "@oh-my-opencode/senpi-task"

import { createTaskTerminalObservers } from "../task/terminal-observers"
import { createOmoNativeDelegationCapture } from "./omo-native-delegation"
import type { OmoNativeEventName } from "./product-identity"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

type Captured = { readonly name: OmoNativeEventName; readonly properties: EventTelemetryProperties }

function stateDir(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-native-delegation-"))
  roots.push(root)
  return root
}

function writeEventLog(dir: string, taskId: string, lines: readonly Record<string, unknown>[]): void {
  mkdirSync(join(dir, "logs"), { recursive: true })
  writeFileSync(
    join(dir, "logs", `${taskId}.jsonl`),
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  )
}

function record(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: "st_0001",
    status: "completed",
    residency_state: "resident",
    created_at: "2026-08-21T00:00:00.000Z",
    updated_at: "2026-08-21T00:00:01.000Z",
    parent_session_id: "parent-session",
    root_session_id: "parent-session",
    depth: 0,
    execution_mode: "in-process",
    model: "anthropic/claude-opus-5",
    notify_on_terminal: false,
    notification: { run_epoch: 0, notified_epoch: -1 },
    task_seq: 7,
    category: "deep",
    background_mode: "foreground",
    spawn_spec: { version: 1, cwd: "/repo", prompt: "work" },
    run_stats: { runtime_ms: 5, turns: 1, tool_calls: 1, duration_status: "monotonic", token_status: "complete", cost_status: "unavailable" },
    ...overrides,
  }
}

function harness(dir: string, options: { readonly capture?: (name: OmoNativeEventName, properties: EventTelemetryProperties) => void } = {}) {
  const captured: Captured[] = []
  const diagnostics: unknown[] = []
  const observers = createTaskTerminalObservers()
  const dispose = createOmoNativeDelegationCapture({
    captureEvent: options.capture ?? ((name, properties) => captured.push({ name, properties })),
    diagnostics: (input) => diagnostics.push(input),
    hashSessionId: (raw) => `hashed:${raw}`,
    observers,
    stateDir: dir,
  })
  return { captured, diagnostics, dispose, notify: observers.notify }
}

describe("omo-native delegation capture", () => {
  test("#given a terminal edge for a task with two steered and one steer_queued event at the current run_epoch #when captured #then task_send_running_count is 2 and task_send_queued_count is 1 and prior-epoch events are ignored", () => {
    // given
    const dir = stateDir()
    writeEventLog(dir, "st_0001", [
      { type: "steered", payload: { delivered: "steer", run_epoch: 0 } },
      { type: "steered", payload: { delivered: "followUp", run_epoch: 1 } },
      { type: "steered", payload: { delivered: "steer", run_epoch: 1 } },
      { type: "steer_queued", payload: { queue_position: 1, run_epoch: 1 } },
      { type: "steer_queued", payload: { queue_position: 1, run_epoch: 0 } },
      { type: "revived", payload: { run_epoch: 1 } },
    ])
    const { captured, notify, dispose } = harness(dir)

    // when
    notify({ record: record({ notification: { run_epoch: 1, notified_epoch: -1 } }), previousStatus: "running" })
    dispose()

    // then
    expect(captured).toHaveLength(1)
    expect(captured[0]?.name).toBe("delegation_completed")
    expect(captured[0]?.properties).toMatchObject({
      task_send_running_count: 2,
      task_send_queued_count: 1,
      run_epoch: 1,
    })
  })

  test("#given a missing task event log #when a terminal edge fires #then the counters are zero and the event still ships", () => {
    // given
    const dir = stateDir()
    const { captured, notify, dispose } = harness(dir)

    // when
    notify({ record: record(), previousStatus: "running" })
    dispose()

    // then
    expect(captured).toHaveLength(1)
    expect(captured[0]?.properties).toMatchObject({ task_send_running_count: 0, task_send_queued_count: 0 })
  })

  test("#given a task that completes then is revived and errors #when both terminals are captured #then two events share task_seq with run_epoch 0 and 1 and the second carries start_reason \"revive_after_completed\"", () => {
    // given
    const dir = stateDir()
    const { captured, notify, dispose } = harness(dir)

    // when
    notify({ record: record({ status: "completed" }), previousStatus: "running" })
    writeEventLog(dir, "st_0001", [{ type: "revived", payload: { run_epoch: 1 } }])
    notify({
      record: record({ status: "error", notification: { run_epoch: 1, notified_epoch: -1 } }),
      previousStatus: "running",
    })
    dispose()

    // then
    expect(captured.map(({ properties }) => [properties.task_seq, properties.run_epoch, properties.start_reason])).toEqual([
      [7, 0, "initial_spawn"],
      [7, 1, "revive_after_completed"],
    ])
  })

  test("#given a revive after an errored run #when the next terminal is captured #then the reason names recovery, not re-query", () => {
    // given
    const dir = stateDir()
    const { captured, notify, dispose } = harness(dir)

    // when
    notify({ record: record({ status: "error" }), previousStatus: "running" })
    writeEventLog(dir, "st_0001", [{ type: "revived", payload: { run_epoch: 1 } }])
    notify({
      record: record({ status: "completed", notification: { run_epoch: 1, notified_epoch: -1 } }),
      previousStatus: "running",
    })
    dispose()

    // then
    expect(captured[1]?.properties.start_reason).toBe("revive_after_error")
  })

  test("#given a lost-to-lost reason update and a residency evict on a terminal record #when observed #then zero events are captured", () => {
    // given
    const dir = stateDir()
    const { captured, notify, dispose } = harness(dir)
    const lost = record({ status: "lost" })

    // when
    notify({ record: lost, previousStatus: "running" })
    notify({ record: { ...lost, error_message: "still lost" }, previousStatus: "lost" })
    notify({ record: { ...lost, residency_state: "evicted" }, previousStatus: "lost" })

    // then
    expect(captured).toHaveLength(1)
    dispose()
  })

  test("#given a transport that throws and one that never resolves #when a terminal edge fires #then the store transition still returns and the diagnostics logger receives the failure", () => {
    // given
    const dir = stateDir()
    const throwing = harness(dir, {
      capture: () => {
        throw new Error("capture failed")
      },
    })

    // when / then: the observer body never throws back into the store write
    expect(() => throwing.notify({ record: record(), previousStatus: "running" })).not.toThrow()
    expect(throwing.diagnostics).toHaveLength(1)
    throwing.dispose()

    const hanging = harness(dir, { capture: () => new Promise<never>(() => undefined) as unknown as void })
    expect(() => hanging.notify({ record: record({ task_id: "st_0002" }), previousStatus: "running" })).not.toThrow()
    hanging.dispose()
  })

  test("#given a resumed task whose parent_session_id differs from the live session #when captured #then the event uses the parent hash", () => {
    // given
    const dir = stateDir()
    const { captured, notify, dispose } = harness(dir)

    // when
    notify({ record: record({ parent_session_id: "older-session" }), previousStatus: "running" })
    dispose()

    // then
    expect(captured[0]?.properties.$session_id).toBe("hashed:older-session")
  })

  test("#given a disposed capture #when a later terminal edge fires #then nothing is captured", () => {
    // given
    const dir = stateDir()
    const { captured, notify, dispose } = harness(dir)

    // when
    dispose()
    notify({ record: record(), previousStatus: "running" })

    // then
    expect(captured).toEqual([])
  })
})
