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
  type RunnerOutcome,
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

type DeferredOutcome = { readonly promise: Promise<RunnerOutcome>; readonly resolve: (outcome: RunnerOutcome) => void }

function deferredOutcome(): DeferredOutcome {
  let resolve!: (outcome: RunnerOutcome) => void
  const promise = new Promise<RunnerOutcome>((settled) => {
    resolve = settled
  })
  return { promise, resolve }
}

type SettleableHandle = {
  readonly handle: ManagedChildHandle
  readonly followUpCalls: string[]
  settle(outcome: RunnerOutcome): void
}

// A runner whose handles re-arm a fresh outcome cycle after every settle, so a revived task
// (re-tracked under a new epoch) awaits its OWN completion.
function settleableRunner(): { readonly runner: ManagedRunner; readonly handles: Map<string, SettleableHandle> } {
  const handles = new Map<string, SettleableHandle>()
  const runner: ManagedRunner = {
    start: (spec): Promise<ManagedChildHandle> => {
      const followUpCalls: string[] = []
      let cycle = deferredOutcome()
      const entry: SettleableHandle = {
        followUpCalls,
        handle: {
          task_id: spec.taskId,
          sessionId: `session-${spec.taskId}`,
          pid: undefined,
          steer: () => Promise.resolve(),
          followUp: (text) => {
            followUpCalls.push(text)
            return Promise.resolve()
          },
          abort: () => Promise.resolve(),
          subscribe: () => () => {},
          waitForOutcome: () => cycle.promise,
          lastAssistantText: () => undefined,
          dispose: () => Promise.resolve(),
        },
        settle: (outcome) => {
          const current = cycle
          cycle = deferredOutcome()
          current.resolve(outcome)
        },
      }
      handles.set(spec.taskId, entry)
      return Promise.resolve(entry.handle)
    },
  }
  return { runner, handles }
}

const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0))

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

function createRevivalHarness(): {
  readonly manager: TaskManager
  readonly messages: ParentNotifierMessage[]
  readonly handles: Map<string, SettleableHandle>
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
  const { runner, handles } = settleableRunner()
  const manager = createTaskManager({
    store,
    runners: { "in-process": runner, process: runner },
    planner: () => ({ kind: "resolved", plan: { model: "anthropic/claude" } }),
    config: OmoTaskSettingsSchema.parse({ default_concurrency: 5, max_depth: 1 }),
    cwd: backing.stateDir,
  })
  managerRef = manager
  return { manager, messages, handles }
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

describe("completion bridge task_send revival wake (#6532)", () => {
  it("#given a sync spawn that completed and was revived via task_send #when the revived run completes #then the idle parent receives exactly one wake for the revived epoch", async () => {
    // given
    const harness = createRevivalHarness()
    const started = await harness.manager.start({
      prompt: "work",
      parent_session_id: "parent-session",
      depth: 1,
      category: "quick",
      run_in_background: false,
    })
    if (started.kind !== "started") throw new Error("expected started task")
    const handle = harness.handles.get(started.task_id)
    if (handle === undefined) throw new Error("expected a settleable handle")

    // when (the synchronous run completes while the parent watches: no wake yet)
    handle.settle({ status: "completed", finalResponse: "first pass" })
    await flush()

    // then (sync-task suppression stays intact before any revival)
    expect(harness.manager.wasBackground(started.task_id)).toBe(false)
    expect(harness.messages).toHaveLength(0)

    // when (task_send revives the terminal resident child)
    const revived = await harness.manager.continueTask(started.task_id, "second pass")
    if (revived.kind !== "continued" || revived.delivered !== "revive") {
      throw new Error(`expected a revival, got ${JSON.stringify(revived)}`)
    }

    // then (the revived run completes: exactly ONE parent wake fires)
    handle.settle({ status: "completed", finalResponse: "second pass" })
    await flush()
    expect(harness.messages).toHaveLength(1)
    expect(harness.messages[0]?.details[0]?.task_id).toBe(started.task_id)
    expect(harness.messages[0]?.triggerTurn).toBe(true)
  })

  it("#given a revived sync task #when further task_send revivals complete #then each run_epoch wakes the parent exactly once", async () => {
    // given
    const harness = createRevivalHarness()
    const started = await harness.manager.start({
      prompt: "work",
      parent_session_id: "parent-session",
      depth: 1,
      category: "quick",
      run_in_background: false,
    })
    if (started.kind !== "started") throw new Error("expected started task")
    const handle = harness.handles.get(started.task_id)
    if (handle === undefined) throw new Error("expected a settleable handle")
    handle.settle({ status: "completed", finalResponse: "first pass" })
    await flush()
    expect(harness.messages).toHaveLength(0)

    // when (two consecutive revivals complete)
    const first = await harness.manager.continueTask(started.task_id, "second pass")
    if (first.kind !== "continued" || first.delivered !== "revive") {
      throw new Error(`expected a revival, got ${JSON.stringify(first)}`)
    }
    handle.settle({ status: "completed", finalResponse: "second pass" })
    await flush()
    const second = await harness.manager.continueTask(started.task_id, "third pass")
    if (second.kind !== "continued" || second.delivered !== "revive") {
      throw new Error(`expected a revival, got ${JSON.stringify(second)}`)
    }
    handle.settle({ status: "completed", finalResponse: "third pass" })
    await flush()

    // then (one wake per epoch, never duplicated)
    expect(harness.messages).toHaveLength(2)
    expect(harness.messages.map((message) => message.details[0]?.task_id)).toEqual([started.task_id, started.task_id])
  })

  it("#given an originally background spawn #when it completes and is revived via task_send #then every epoch still notifies exactly once", async () => {
    // given
    const harness = createRevivalHarness()
    const started = await harness.manager.start({
      prompt: "work",
      parent_session_id: "parent-session",
      depth: 1,
      category: "quick",
      run_in_background: true,
    })
    if (started.kind !== "started") throw new Error("expected started task")
    const handle = harness.handles.get(started.task_id)
    if (handle === undefined) throw new Error("expected a settleable handle")

    // when (the original background run completes: epoch 0 notifies)
    handle.settle({ status: "completed", finalResponse: "first pass" })
    await flush()
    expect(harness.messages).toHaveLength(1)

    // then (the revival completes: epoch 1 notifies again, promotion must not duplicate or suppress)
    const revived = await harness.manager.continueTask(started.task_id, "second pass")
    if (revived.kind !== "continued" || revived.delivered !== "revive") {
      throw new Error(`expected a revival, got ${JSON.stringify(revived)}`)
    }
    handle.settle({ status: "completed", finalResponse: "second pass" })
    await flush()
    expect(harness.messages).toHaveLength(2)
  })
})
