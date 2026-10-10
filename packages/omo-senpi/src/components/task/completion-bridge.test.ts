import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import {
  createCompletionNotifier,
  createTaskManager,
  createTaskRecordStore,
  markRecordLostForReconciliation,
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

function createHarness(options: { currentSessionId?: string | null } = {}): {
  readonly manager: TaskManager
  readonly messages: ParentNotifierMessage[]
  readonly complete: (taskId: string) => void
  readonly lose: (taskId: string) => void
  readonly notifyCalls: () => number
  readonly notifiedEpoch: (taskId: string) => number | undefined
} {
  const backing = createTaskRecordStore({ project_dir: tempProject() })
  const messages: ParentNotifierMessage[] = []
  const completion = createCompletionNotifier({
    notifier: { enqueue: (message) => messages.push(message) },
    store: backing,
  })
  let managerRef: TaskManager | undefined
  let notifyCalls = 0
  const store = createCompletionObservingStore(backing, {
    // Counts the bridge's own calls, so "once" is the bridge's guarantee, not the notifier's dedupe.
    notifier: { ...completion, notifyTerminal: (input) => { notifyCalls += 1; return completion.notifyTerminal(input) } },
    parentState: () => ({ kind: "idle" }),
    wasBackground: (taskId) => managerRef?.wasBackground(taskId) ?? false,
    currentSessionId: () => (options.currentSessionId === null ? undefined : (options.currentSessionId ?? "parent-session")),
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
    notifyCalls: () => notifyCalls,
    notifiedEpoch: (taskId) => backing.load(taskId)?.notification.notified_epoch,
    complete: (taskId) => {
      store.transition(taskId, {
        type: "complete",
        timestamp: "2026-07-28T00:00:01.000Z",
        final_response: "completed after conversion",
      })
    },
    lose: (taskId) => {
      store.mutate(taskId, (record) => markRecordLostForReconciliation(record, {
        timestamp: "2026-07-28T00:00:01.000Z",
        error_message: "revival deferred: model_unavailable; exhausted 3 retry attempts",
      }).record)
    },
  }
}

afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project, { recursive: true, force: true })
})

describe("completion bridge live background promotion", () => {
  it("#given a background child #when bounded revival marks it lost through mutate #then its parent is notified exactly once without another session start (omo#9498)", async () => {
    const harness = createHarness()
    const started = await harness.manager.start({
      prompt: "work",
      parent_session_id: "parent-session",
      depth: 1,
      category: "quick",
      run_in_background: true,
    })
    if (started.kind !== "started") throw new Error("expected started task")
    harness.lose(started.task_id)
    harness.lose(started.task_id)
    expect(harness.notifyCalls()).toBe(1)
    expect(harness.messages).toHaveLength(1)
    expect(harness.messages[0]?.details[0]?.task_id).toBe(started.task_id)
    expect(harness.messages[0]?.details[0]?.status).toBe("lost")
  })

  it("#given another session's child #when a reconcile marks it lost #then this session is not notified and the child's own notification stays pending (review of omo#9714)", async () => {
    const harness = createHarness({ currentSessionId: "other-session" })
    const started = await harness.manager.start({
      prompt: "work",
      parent_session_id: "parent-session",
      depth: 1,
      category: "quick",
      run_in_background: true,
    })
    if (started.kind !== "started") throw new Error("expected started task")
    harness.lose(started.task_id)
    expect(harness.notifyCalls()).toBe(0)
    expect(harness.messages).toHaveLength(0)
    // Still owed: the owning session's next start delivers it.
    expect(harness.notifiedEpoch(started.task_id)).toBe(-1)
  })

  it("#given no known current session #when a reconcile marks a child lost #then nothing is notified and the notice stays owed", async () => {
    const harness = createHarness({ currentSessionId: null })
    const started = await harness.manager.start({
      prompt: "work",
      parent_session_id: "parent-session",
      depth: 1,
      category: "quick",
      run_in_background: true,
    })
    if (started.kind !== "started") throw new Error("expected started task")
    harness.lose(started.task_id)
    expect(harness.notifyCalls()).toBe(0)
    expect(harness.notifiedEpoch(started.task_id)).toBe(-1)
  })

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
