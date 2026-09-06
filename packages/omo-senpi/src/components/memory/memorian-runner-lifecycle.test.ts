import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readdir, readFile } from "node:fs"
import { join } from "node:path"
import type { CreateAgentSessionOptions, ToolDefinition } from "@code-yeongyu/senpi"
import type { CreateChildSession } from "@oh-my-opencode/senpi-task"
import { PendingNudges } from "@oh-my-opencode/memory-core"
import type { ChildHandle } from "@oh-my-opencode/senpi-task"
import { MemorianGateRunner } from "./memorian-runner"
import { CANDIDATE_PATH, fixture, launchInput, nudgeOnce, registrySnapshot, roots, runnerOptions, scriptedSession, SESSION_ID } from "./memorian-runner.test-support"
import { rmEfaultTolerant } from "./teardown.test-support"

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))) })

describe("MemorianGateRunner", () => {
  test("#given child setup never resolves #when the whole-launch deadline fires #then the latch releases and a late handle is disposed", async () => {
    // given
    const { identityPaths } = await fixture()
    let resolveStart: ((handle: ChildHandle) => void) | undefined
    let disposed = 0
    let resolveDisposed: (() => void) | undefined
    const lateDisposed = new Promise<void>((resolve) => { resolveDisposed = resolve })
    const lateHandle: ChildHandle = {
      task_id: "late",
      sessionId: "late",
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => undefined,
      subscribe: () => () => undefined,
      waitForIdle: async () => ({ status: "cancelled" }),
      lastAssistantText: () => undefined,
      dispose: () => { disposed += 1; resolveDisposed?.() },
    }
    // The deadline must fire only AFTER runner.start() has been invoked: setup does file writes and a
    // sidecar import first, and on a slow runner a wall-clock deadline can beat start() itself, in
    // which case there is no late handle to dispose and the scenario is vacuous. Gate on the start
    // signal, then let a short deadline win the race against a start promise that never resolves.
    let resolveStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => { resolveStarted = resolve })
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      deadlineMs: 250,
      createRunner: () => ({
        start: async () => new Promise<ChildHandle>((resolve) => { resolveStart = resolve; resolveStarted?.() }),
      }),
    }))

    // when
    const launched = runner.launch(launchInput())
    await Promise.race([started, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("runner.start was never invoked")), 5_000))])
    const result = await launched
    resolveStart?.(lateHandle)
    // The late handle is torn down inside the setup continuation; await that signal, never a tick count.
    await Promise.race([lateDisposed, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("late handle was never disposed")), 5_000))])

    // then
    expect(result).toMatchObject({ status: "failed", cause: "deadline" })
    expect((await runner.launch(launchInput())).status).not.toBe("active")
    expect(disposed).toBe(1)
  })

  test("#given a child that never settles #when the deadline fires #then the child is aborted and disposed", async () => {
    // given
    const { identityPaths } = await fixture()
    let resolveIdle: (() => void) | undefined
    let resolveAbort: (() => void) | undefined
    let resolveDispose: (() => void) | undefined
    const aborted = new Promise<void>((resolve) => { resolveAbort = resolve })
    const disposed = new Promise<void>((resolve) => { resolveDispose = resolve })
    const handle: ChildHandle = {
      task_id: "hung",
      sessionId: "hung",
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => { resolveAbort?.(); resolveIdle?.() },
      subscribe: () => () => undefined,
      waitForIdle: () => new Promise((resolve) => { resolveIdle = () => resolve({ status: "cancelled" }) }),
      lastAssistantText: () => undefined,
      dispose: () => { resolveDispose?.() },
    }
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      createRunner: () => ({ start: async () => handle }),
      deadlineMs: 20,
    }))

    // when
    const result = await runner.launch(launchInput())
    await Promise.all([aborted, disposed])

    // then
    expect(result).toMatchObject({ status: "failed", cause: "deadline" })
    expect(result.runId).toMatch(/^[0-9a-f-]{36}$/)
  })

  test("#given a completed child blocked on persistence #when cancel is called #then the pending payload is retracted", async () => {
    // given
    const { identityPaths } = await fixture()
    const child = scriptedSession(async (options) => { await nudgeOnce(options) })
    let releaseWrite: (() => void) | undefined
    let resolveWriteEntered: (() => void) | undefined
    const writeEntered = new Promise<void>((resolve) => { resolveWriteEntered = resolve })
    const pendingNudges = {
      write: async () => {
        resolveWriteEntered?.()
        await new Promise<void>((resolve) => { releaseWrite = resolve })
      },
      delete: async () => { releaseWrite?.() },
    }
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      createSession: child.createSession,
      pendingNudges,
      deadlineMs: 1000,
    }))

    // when
    const launch = runner.launch(launchInput())
    await child.whenPrompted()
    child.resolve()
    await writeEntered
    const cancelling = runner.cancel()
    releaseWrite?.()
    await cancelling
    const result = await launch

    // then
    expect(result).toMatchObject({ status: "dropped", cause: "cancelled" })
  })

  test("#given a child in flight #when cancel is called #then it aborts and disposes without writing a late nudge", async () => {
    // given
    const { identityPaths } = await fixture()
    let release: (() => void) | undefined
    let aborted = 0
    let disposed = 0
    let resolveAdmitted: (() => void) | undefined
    const admitted = new Promise<void>((resolve) => { resolveAdmitted = resolve })
    const handle: ChildHandle = {
      task_id: "cancelled",
      sessionId: "cancelled",
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => { aborted += 1; release?.() },
      subscribe: () => () => undefined,
      waitForIdle: () => {
        const wait = new Promise<{ readonly status: "cancelled" }>((resolve) => {
          release = () => resolve({ status: "cancelled" })
        })
        resolveAdmitted?.()
        return wait
      },
      lastAssistantText: () => undefined,
      dispose: () => { if (disposed > 0) return; disposed += 1 },
    }
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      createRunner: () => ({ start: async () => handle }),
      deadlineMs: 5000,
    }))

    // when: waitForIdle is only armed after the handle is admitted
    const pending = runner.launch(launchInput())
    await Promise.race([admitted, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("handle was never admitted")), 5_000))])
    await runner.cancel()
    const result = await pending

    // then
    expect(result).toMatchObject({ status: "dropped", cause: "cancelled" })
    expect(aborted).toBe(1)
    expect(disposed).toBe(1)
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  })

  test("#given child setup is still deferred #when cancel is requested then the handle resolves #then the late handle is dropped without a pending payload", async () => {
    // given
    const { identityPaths } = await fixture()
    let resolveStart: ((handle: ChildHandle) => void) | undefined
    let resolveStarted: (() => void) | undefined
    let resolveDisposed: (() => void) | undefined
    let resolveAbortEntered: (() => void) | undefined
    let releaseAbort: (() => void) | undefined
    let aborted = 0
    let disposed = 0
    const started = new Promise<void>((resolve) => { resolveStarted = resolve })
    const abortEntered = new Promise<void>((resolve) => { resolveAbortEntered = resolve })
    const lateDisposed = new Promise<void>((resolve) => { resolveDisposed = resolve })
    const lateHandle: ChildHandle = {
      task_id: "setup-cancelled",
      sessionId: "setup-cancelled",
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => { aborted += 1; resolveAbortEntered?.(); await new Promise<void>((resolve) => { releaseAbort = resolve }) },
      subscribe: () => () => undefined,
      waitForIdle: async () => ({ status: "cancelled" }),
      lastAssistantText: () => undefined,
      dispose: () => { if (disposed > 0) return; disposed += 1; resolveDisposed?.() },
    }
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      deadlineMs: 5000,
      createRunner: () => ({
        start: async () => new Promise<ChildHandle>((resolve) => { resolveStart = resolve; resolveStarted?.() }),
      }),
    }))

    // when
    const launched = runner.launch(launchInput())
    await Promise.race([started, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("runner.start was never invoked")), 5_000))])
    const cancelling = runner.cancel()
    let cancellationResolved = false
    let launchResolved = false
    void cancelling.then(() => { cancellationResolved = true })
    void launched.then(() => { launchResolved = true })
    resolveStart?.(lateHandle)
    await Promise.race([abortEntered, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("late handle abort was never entered")), 5_000))])
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(cancellationResolved).toBe(false)
    expect(launchResolved).toBe(false)
    releaseAbort?.()
    await Promise.race([lateDisposed, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("late handle was never disposed")), 5_000))])
    await cancelling
    const result = await launched

    // then
    expect(result).toMatchObject({ status: "dropped", cause: "cancelled" })
    expect(aborted).toBe(1)
    expect(disposed).toBe(1)
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  })

})
