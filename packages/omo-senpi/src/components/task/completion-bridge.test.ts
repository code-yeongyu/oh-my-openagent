import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import {
  createCompletionNotifier,
  createTaskManager,
  createTaskRecordStore,
  type ManagedChildHandle,
  type ManagedRunner,
  type ParentNotifierMessage,
  type TaskManager,
} from "@oh-my-opencode/senpi-task"

import { createCompletionObservingStore } from "./completion-bridge"

const projects: string[] = []

function tempProject(): string {
  const project = mkdtempSync(join(tmpdir(), "omo-senpi-completion-bridge-"))
  projects.push(project)
  return project
}

function pendingRunner(): ManagedRunner {
  return {
    start: (spec): Promise<ManagedChildHandle> => Promise.resolve({
      task_id: spec.taskId,
      sessionId: `session-${spec.taskId}`,
      pid: undefined,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => Promise.resolve(),
      subscribe: () => () => {},
      waitForOutcome: () => new Promise(() => {}),
      lastAssistantText: () => undefined,
      dispose: () => Promise.resolve(),
    }),
  }
}

function createHarness(): {
  readonly manager: TaskManager
  readonly messages: ParentNotifierMessage[]
  readonly complete: (taskId: string) => void
} {
  const backing = createTaskRecordStore({ project_dir: tempProject() })
  const messages: ParentNotifierMessage[] = []
  const completion = createCompletionNotifier({
    notifier: { enqueue: (message) => messages.push(message) },
    store: backing,
  })
  let managerRef: TaskManager | undefined
  const store = createCompletionObservingStore(backing, {
    notifier: completion,
    parentState: () => ({ kind: "idle" }),
    wasBackground: (taskId) => managerRef?.wasBackground(taskId) ?? false,
  })
  const runner = pendingRunner()
  const manager = createTaskManager({
    store,
    runners: { "in-process": runner, process: runner },
    planner: () => ({ kind: "resolved", plan: { model: "anthropic/claude" } }),
    config: OmoTaskSettingsSchema.parse({ default_concurrency: 5, max_depth: 1 }),
    cwd: backing.stateDir,
  })
  managerRef = manager
  return {
    manager,
    messages,
    complete: (taskId) => {
      store.transition(taskId, {
        type: "complete",
        timestamp: "2026-07-28T00:00:01.000Z",
        final_response: "completed after conversion",
      })
    },
  }
}

afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project, { recursive: true, force: true })
})

describe("completion bridge live background promotion", () => {
  it("#given a foreground start promoted before terminal #when completion applies #then the live manager flag delivers a notification", async () => {
    // given
    const harness = createHarness()
    const started = await harness.manager.start({
      prompt: "work",
      parent_session_id: "parent-session",
      depth: 1,
      category: "quick",
      run_in_background: false,
    })
    if (started.kind !== "started") throw new Error("expected started task")
    expect(harness.manager.wasBackground(started.task_id)).toBe(false)

    // when
    expect(harness.manager.promoteToBackground(started.task_id)).toBe(true)
    expect(harness.manager.promoteToBackground(started.task_id)).toBe(false)
    harness.complete(started.task_id)

    // then
    expect(harness.manager.wasBackground(started.task_id)).toBe(true)
    expect(harness.messages).toHaveLength(1)
    expect(harness.messages[0]?.details[0]?.task_id).toBe(started.task_id)
  })

  it("#given a genuinely foreground start #when completion applies without promotion #then sync-task notification suppression remains intact", async () => {
    // given
    const harness = createHarness()
    const started = await harness.manager.start({
      prompt: "work",
      parent_session_id: "parent-session",
      depth: 1,
      category: "quick",
      run_in_background: false,
    })
    if (started.kind !== "started") throw new Error("expected started task")

    // when
    harness.complete(started.task_id)

    // then
    expect(harness.manager.wasBackground(started.task_id)).toBe(false)
    expect(harness.messages).toHaveLength(0)
  })
})
