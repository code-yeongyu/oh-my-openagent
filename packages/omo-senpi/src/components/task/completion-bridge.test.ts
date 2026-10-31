import { mkdtempSync, renameSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import {
  createCompletionNotifier,
  createTaskManager,
  createTaskRecord,
  createTaskRecordStore,
  markRecordLostForReconciliation,
  RunnerError,
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

function createHarness(options: {
  currentSessionId?: string | null
  runner?: ManagedRunner
  onMessage?: (message: ParentNotifierMessage) => void
} = {}): {
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
    notifier: { enqueue: (message) => { messages.push(message); options.onMessage?.(message) } },
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
  const runner = options.runner ?? pendingRunner()
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

it("#given a held pending task file #when spawn failure is marked twice #then one completion is delivered and its epoch persists off the held target", () => {
  // given
  const backing = createTaskRecordStore({ project_dir: tempProject() }, {
    platform: "win32",
    rename: (from, to) => {
      if (String(to).endsWith(".json")) throw Object.assign(new Error("held task target"), { code: "EPERM" })
      renameSync(from, to)
    },
    sleep: () => {},
  })
  const record = createTaskRecord({
    parent_session_id: "parent-session", root_session_id: "parent-session", depth: 1,
    execution_mode: "in-process", model: "test/model", notify_on_terminal: true,
  })
  backing.save(record)
  const messages: ParentNotifierMessage[] = []
  const notifier = createCompletionNotifier({ store: backing, notifier: { enqueue: message => { messages.push(message) } } })
  let notifications = 0
  const store = createCompletionObservingStore(backing, {
    notifier: { ...notifier, notifyTerminal: input => { notifications += 1; return notifier.notifyTerminal(input) } },
    parentState: () => ({ kind: "idle" }), wasBackground: () => true, currentSessionId: () => "parent-session",
  })
  // when
  store.markSpawnFailed(record, "EPERM errno=-4048 file=held.json")
  store.markSpawnFailed(record)
  // then
  expect(notifications).toBe(1)
  expect(messages).toHaveLength(1)
  expect(messages[0]?.details[0]?.status).toBe("error")
  expect(backing.load(record.task_id)?.error_message).toBe("EPERM errno=-4048 file=held.json")
  expect(backing.load(record.task_id)?.notification.notified_epoch).toBe(record.notification.run_epoch)
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

  it("#given a background start the task host refuses after the caller stopped waiting #when the refusal lands #then the parent is notified exactly once (omo#10042)", async () => {
    // given
    const release = Promise.withResolvers<void>()
    const refusing: ManagedRunner = {
      start: () => release.promise.then(() => {
        throw new RunnerError({ kind: "host_unavailable", reason: "host_busy", message: "the task host is not answering" })
      }),
    }
    const arrived = Promise.withResolvers<ParentNotifierMessage>()
    const harness = createHarness({ runner: refusing, onMessage: arrived.resolve })
    const started = await harness.manager.start({
      prompt: "work",
      parent_session_id: "parent-session",
      depth: 1,
      category: "quick",
      run_in_background: true,
    })
    if (started.kind !== "started") throw new Error("expected started task")
    expect(started.starting).toBe(true)

    // when
    release.resolve()
    const message = await Promise.race([
      arrived.promise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("waited 2s for the start-failure notification, it never came")), 2_000)),
    ])

    // then
    expect(message.details[0]?.task_id).toBe(started.task_id)
    expect(message.details[0]?.status).toBe("error")
    expect(harness.notifyCalls()).toBe(1)
    expect(harness.messages).toHaveLength(1)
  })
})
