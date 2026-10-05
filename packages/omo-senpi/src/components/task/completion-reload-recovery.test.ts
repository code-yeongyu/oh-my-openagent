import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import { createTaskRecordStore, type TaskRecord, type TaskRecordStore } from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import { composeTaskEngine, type TaskEngine } from "./engine"

// The loss window this pins (issue #7933 review, finding 1): a background child finishes inside the
// 200 ms idle-injection batch window, senpi_task persists notified_epoch because the adapter's
// enqueue returned, and then /reload retires the coordinator and the queued injection is gone. If
// that drop is not reported back, reconcileUnnotifiedNotifications skips the record forever
// (notified_epoch >= run_epoch) and the parent NEVER learns its task completed.

const TASK_ID = "st_0000000a"
const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-senpi-completion-reload-"))
  tempRoots.push(dir)
  return dir
}

type Generation = {
  readonly engine: TaskEngine
  readonly coordinator: IdleInjectionCoordinator
  readonly pi: FakeExtensionAPI
  /** Runs the callback the batch-window scheduler armed, if retirement did not cancel it. */
  readonly runArmedFlush: () => void
}

// One extension generation, wired exactly like compose.ts wires production: one coordinator per
// activation, delivering through that generation's pi. senpi rebuilds this whole graph on /reload.
function composeGeneration(cwd: string): Generation {
  const pi = new FakeExtensionAPI()
  let armed: (() => void) | undefined
  const coordinator = new IdleInjectionCoordinator(
    (message, options) => pi.sendMessage(message, { triggerTurn: true, deliverAs: options.deliverAs }),
    {
      scheduleFlush: (flush) => {
        armed = flush
        return () => {
          armed = undefined
        }
      },
    },
  )
  const engine = composeTaskEngine({
    pi,
    omoConfig: loadOmoConfig({ cwd }).config,
    cwd,
    sharedParentTools: () => [],
    coordinator,
  })
  return {
    engine,
    coordinator,
    pi,
    runArmedFlush: () => {
      const flush = armed
      armed = undefined
      flush?.()
    },
  }
}

function terminalRecord(): TaskRecord {
  return {
    task_id: TASK_ID,
    name: "background-child",
    parent_session_id: "session-a",
    root_session_id: "session-a",
    depth: 1,
    execution_mode: "process",
    model: "omo-mock/mock-1",
    status: "completed",
    residency_state: "persisted_only",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:05.000Z",
    final_response: "child finished its work",
    notify_on_terminal: true,
    notification: { run_epoch: 0, notified_epoch: -1 },
  }
}

function seedTerminalChild(cwd: string): TaskRecordStore {
  const store = createTaskRecordStore({ project_dir: cwd })
  store.save(terminalRecord())
  return store
}

function notification(store: TaskRecordStore): TaskRecord["notification"] {
  const record = store.load(TASK_ID)
  if (record === null) throw new Error(`missing task record ${TASK_ID}`)
  return record.notification
}

describe("background completion survival across a reload", () => {
  test("#given a child completing inside the batch window #when the reload retires the coordinator #then the rebuilt session redelivers the completion", async () => {
    // given a terminal background child observed by the live generation
    const cwd = tempProject()
    const first = composeGeneration(cwd)
    const store = seedTerminalChild(cwd)

    const result = first.engine.notifier.notifyTerminal({
      record: terminalRecord(),
      parentState: { kind: "streaming" },
      runInBackground: true,
    })

    // the injection is only QUEUED (the batch window is still open), yet the epoch is already persisted
    expect(result.kind).toBe("delivered")
    expect(first.pi.messages).toHaveLength(0)
    expect(notification(store).notified_epoch).toBe(0)

    // when /reload arrives: senpi emits session_shutdown on the old runner, compose retires the queue
    first.coordinator.retire()
    first.runArmedFlush()

    // then nothing was pushed into the dying generation, and the record owes its notification again
    expect(first.pi.messages).toHaveLength(0)
    expect(notification(store).notified_epoch).toBe(-1)
    expect(notification(store).notification_failed_epoch).toBe(0)

    // and the rebuilt generation's session_start reconcile delivers it for real
    const second = composeGeneration(cwd)
    second.engine.notifier.reconcileUnnotifiedNotifications({
      sessionId: "session-a",
      parentState: { kind: "idle" },
    })
    await Promise.resolve()

    expect(second.pi.messages).toHaveLength(1)
    expect(JSON.stringify(second.pi.messages[0])).toContain("child finished its work")
    expect(notification(store).notified_epoch).toBe(0)
  })

  test("#given an already-retired coordinator #when a child completes #then the delivery is reported failed instead of notified", () => {
    // given a generation whose session already shut down
    const cwd = tempProject()
    const generation = composeGeneration(cwd)
    const store = seedTerminalChild(cwd)
    generation.coordinator.retire()

    // when the child's terminal transition notifies into the retired queue
    const result = generation.engine.notifier.notifyTerminal({
      record: terminalRecord(),
      parentState: { kind: "streaming" },
      runInBackground: true,
    })

    // then the engine sees a failure, so nothing claims the epoch and reconcile still owes it
    expect(result.kind).toBe("failed")
    expect(generation.pi.messages).toHaveLength(0)
    expect(notification(store).notified_epoch).toBe(-1)
    expect(notification(store).notification_failed_epoch).toBe(0)
  })
})
