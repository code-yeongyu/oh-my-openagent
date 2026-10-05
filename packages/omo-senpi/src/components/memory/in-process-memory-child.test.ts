import { describe, expect, test } from "bun:test"
import type { ChildHandle, ChildSpec } from "@oh-my-opencode/senpi-task"

import { runInProcessMemoryChild, type InProcessMemoryChildState } from "./in-process-memory-child"

function handle(overrides: Partial<ChildHandle> = {}): ChildHandle {
  return {
    task_id: "memory-child",
    sessionId: "memory-child",
    steer: async () => undefined,
    followUp: async () => undefined,
    abort: async () => undefined,
    subscribe: () => () => undefined,
    waitForIdle: async () => ({ status: "completed", finalResponse: "" }),
    lastAssistantText: () => undefined,
    dispose: () => undefined,
    ...overrides,
  }
}

function startSpec(): ChildSpec {
  return {
    taskId: "memory-child",
    cwd: "/tmp/memory-child",
    sessionDir: "/tmp/memory-child",
    depth: 1,
    parentSessionId: "parent",
    rootSessionId: "parent",
    prompt: "prompt",
  }
}

function state(): InProcessMemoryChildState {
  return { cancelled: false }
}

describe("runInProcessMemoryChild", () => {
  test("#given start is pending after invocation #when the deadline fires #then a late handle is aborted and disposed once", async () => {
    // given
    let resolveStart: ((child: ChildHandle) => void) | undefined
    let resolveStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => { resolveStarted = resolve })
    let aborted = 0
    let disposed = 0
    let resolveDisposed: (() => void) | undefined
    const disposedSignal = new Promise<void>((resolve) => { resolveDisposed = resolve })
    const late = handle({
      abort: async () => { aborted += 1 },
      dispose: () => { disposed += 1; resolveDisposed?.() },
    })
    const resultPromise = runInProcessMemoryChild({
      runId: "deadline",
      deadlineMs: 1,
      state: state(),
      createRunner: () => ({
        start: async () => {
          resolveStarted?.()
          return await new Promise<ChildHandle>((resolve) => { resolveStart = resolve })
        },
      }),
      setup: async () => undefined,
      buildStart: () => startSpec(),
    })
    await started
    const result = await resultPromise

    // when: the start promise is released after the deadline has already won
    resolveStart?.(late)
    await disposedSignal

    // then
    expect(result).toEqual({ status: "failed", cause: "deadline" })
    expect(aborted).toBe(1)
    expect(disposed).toBe(1)
  })

  test("#given setup still pending when the deadline fires #when setup later resolves #then runner.start is never invoked", async () => {
    // given
    let releaseSetup: (() => void) | undefined
    const setupReleased = new Promise<void>((resolve) => { releaseSetup = resolve })
    let startCalls = 0
    let resolveSetupContinuation: (() => void) | undefined
    const setupContinuation = new Promise<void>((resolve) => { resolveSetupContinuation = resolve })
    const resultPromise = runInProcessMemoryChild({
      runId: "setup-deadline",
      deadlineMs: 1,
      state: state(),
      createRunner: () => ({
        start: async () => {
          startCalls += 1
          return handle()
        },
      }),
      setup: () => setupReleased,
      buildStart: () => startSpec(),
      onSetupSettled: () => { resolveSetupContinuation?.() },
    })

    // when: the deadline wins before setup is released
    const result = await resultPromise
    releaseSetup?.()
    await setupReleased
    await setupContinuation

    // then
    expect(result).toEqual({ status: "failed", cause: "deadline" })
    expect(startCalls).toBe(0)
  })

  test("#given cancellation before start resolves #when the late handle arrives #then it is aborted and disposed once without onHandle", async () => {
    // given
    const childState = state()
    let resolveStart: ((child: ChildHandle) => void) | undefined
    let resolveStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => { resolveStarted = resolve })
    let aborted = 0
    let disposed = 0
    let observed = 0
    const resultPromise = runInProcessMemoryChild({
      runId: "cancelled",
      deadlineMs: 10_000,
      state: childState,
      createRunner: () => ({
        start: async () => {
          resolveStarted?.()
          return await new Promise<ChildHandle>((resolve) => { resolveStart = resolve })
        },
      }),
      setup: async () => undefined,
      buildStart: () => startSpec(),
      onHandle: () => { observed += 1 },
    })
    await started
    childState.cancel?.()

    // when: the late start resolves after cancel has been invoked
    resolveStart?.(handle({
      abort: async () => { aborted += 1 },
      dispose: () => { disposed += 1 },
    }))
    const result = await resultPromise

    // then
    expect(result).toEqual({ status: "failed", cause: "cancelled" })
    expect(observed).toBe(0)
    expect(aborted).toBe(1)
    expect(disposed).toBe(1)
  })

  test("#given setup has settled and runtime import is pending #when cancel is invoked #then runner.start is never invoked", async () => {
    // given
    const childState = state()
    let startCalls = 0
    const result = await runInProcessMemoryChild({
      runId: "import-cancel",
      deadlineMs: 10_000,
      state: childState,
      createRunner: () => ({
        start: async () => {
          startCalls += 1
          return handle()
        },
      }),
      setup: async () => undefined,
      buildStart: () => startSpec(),
      onSetupSettled: () => { childState.cancel?.() },
    })

    // when: cancel lands after setup and before start, while the runtime import is in flight

    // then
    expect(result).toEqual({ status: "failed", cause: "cancelled" })
    expect(startCalls).toBe(0)
  })

  test("#given an accepted child whose turn never settles #when cancel is invoked #then abort and dispose finish once before the launch returns", async () => {
    // given
    const childState = state()
    let aborted = 0
    let disposed = 0
    let resolveHandled: (() => void) | undefined
    const handled = new Promise<void>((resolve) => { resolveHandled = resolve })
    const resultPromise = runInProcessMemoryChild({
      runId: "idle-cancel",
      deadlineMs: 10_000,
      state: childState,
      createRunner: () => ({
        start: async () => handle({
          abort: async () => { aborted += 1 },
          dispose: () => { disposed += 1 },
          waitForIdle: async () => await new Promise(() => undefined),
        }),
      }),
      setup: async () => undefined,
      buildStart: () => startSpec(),
      onHandle: () => { resolveHandled?.() },
    })
    await handled

    // when
    childState.cancel?.()
    const result = await resultPromise

    // then
    expect(result).toEqual({ status: "failed", cause: "cancelled" })
    expect(aborted).toBe(1)
    expect(disposed).toBe(1)
  })

  test("#given start rejects before the deadline #when the child is launched #then session creation failure is returned", async () => {
    // given
    const result = await runInProcessMemoryChild({
      runId: "create-failed",
      deadlineMs: 10_000,
      state: state(),
      createRunner: () => ({ start: async () => { throw new Error("boot failed") } }),
      setup: async () => undefined,
      buildStart: () => startSpec(),
    })

    // when: the runner attempts to start the child

    // then
    expect(result).toEqual({ status: "failed", cause: "session_create_failed" })
  })

  test("#given a child that completes #when the launch settles #then onHandle is called once", async () => {
    // given
    let observed = 0
    const result = await runInProcessMemoryChild({
      runId: "completed",
      deadlineMs: 10_000,
      state: state(),
      createRunner: () => ({ start: async () => handle() }),
      setup: async () => undefined,
      buildStart: () => startSpec(),
      onHandle: () => { observed += 1 },
    })

    // when: the child finishes

    // then
    expect(result).toEqual({ status: "completed" })
    expect(observed).toBe(1)
  })
})
