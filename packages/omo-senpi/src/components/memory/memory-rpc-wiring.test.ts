import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

import { buildIdentityPaths, GitMemoryRepo, type ReservedRun } from "@oh-my-opencode/memory-core"

import type { SenpiExtensionAPI } from "../../extension/types"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import type { MemoryIdentityRuntime } from "./identity-runtime"
import {
  MEMORY_STATUS_RPC_METHOD,
  MEMORY_UPDATED_RPC_EVENT,
  type MemoryRpcSnapshot,
} from "./memory-rpc-bridge"
import {
  MemoryFakeExtensionAPI,
  componentContext,
  loadedMemoryConfig,
  memorySettings,
} from "./memory.test-support"
import type { MemoryStatusResult, RefreshMemoryStatusInput } from "./status"
import { MEMORY_STATUS_KEY } from "./status"
import { createMemoryWiring } from "./wiring"
import { recordReflectionCompletion, type ReflectionCompletionRecord } from "./worker"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

class RpcFakeExtensionAPI extends MemoryFakeExtensionAPI {
  readonly rpcHandlers = new Map<string, (data: unknown) => unknown | Promise<unknown>>()

  constructor() {
    super()
    this.rpc = {
      emit: (name: string, data: unknown) => {
        this.rpcEvents.push({ name, data })
      },
      handle: (name: string, handler: (data: unknown) => unknown | Promise<unknown>) => {
        this.rpcHandlers.set(name, handler)
      },
    } as NonNullable<SenpiExtensionAPI["rpc"]>
  }

  memoryEvents(): MemoryRpcSnapshot[] {
    return this.rpcEvents
      .filter((event) => event.name === MEMORY_UPDATED_RPC_EVENT)
      .map((event) => event.data as MemoryRpcSnapshot)
  }
}

interface Fixture {
  readonly cwd: string
  readonly env: Record<string, string | undefined>
  readonly context: MemoryIdentityContext
  readonly sessionId: string
  readonly identity: string
  readonly setBacklog: (steps: number) => Promise<void>
}

async function createFixture(sessionId = "session-rpc"): Promise<Fixture> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-rpc-wiring-")))
  roots.push(root)
  const identity = "agent-test"
  const paths = buildIdentityPaths(join(root, "memory"), identity)
  await mkdir(join(paths.transcripts, sessionId), { recursive: true })
  await mkdir(join(paths.reflection, "completions"), { recursive: true })
  const context = createMemoryIdentityContext({
    identity,
    identityPaths: paths,
    binding: { identity, repoPathHash: "hash", boundAt: 1 },
  })
  return {
    cwd: join(root, "project"),
    env: { OMO_MEMORY_HOME: join(root, "memory") },
    context,
    sessionId,
    identity,
    setBacklog: async (steps) => {
      await writeFile(
        join(paths.transcripts, sessionId, "state.json"),
        JSON.stringify({
          schema_version: "v3_assistant_steps",
          total_completed_steps: steps,
          reflected_completed_steps: 0,
          steps_since_last_successful_reflection: steps,
        }),
        "utf8",
      )
    },
  }
}

async function fakeRefreshMemoryStatus(input: RefreshMemoryStatusInput): Promise<MemoryStatusResult> {
  if (input.showFooter === false) return { notified: false, footerShown: false }
  input.ui.setStatus(MEMORY_STATUS_KEY, `mem:${input.context.identity} 1m ago`)
  return { notified: false, footerShown: true }
}

function sessionContext(
  sessionId: string,
  statusCalls: Array<{ key: string; text: string | undefined }> = [],
  entries: readonly unknown[] = [],
): unknown {
  return {
    sessionManager: {
      getBranch: () => entries,
      getEntries: () => entries,
      getSessionId: () => sessionId,
    },
    ui: {
      notify: () => {},
      setStatus: (key: string, text: string | undefined) => {
        statusCalls.push({ key, text })
      },
    },
  }
}

function memoryResult(toolName = "memory", isError = false): Record<string, unknown> {
  return { type: "tool_result", toolName, isError, input: {}, content: [{ type: "text", text: "done" }] }
}

function reservedRun(runId: string): ReservedRun {
  return {
    runId,
    request: { trigger: "manual", conversationIds: ["session-rpc"], snapshots: [] },
    reservedAt: "2026-08-12T00:00:00.000Z",
  }
}

function wiringFor(fixture: Fixture, runtime?: MemoryIdentityRuntime) {
  return createMemoryWiring({
    sessions: new Map([[fixture.sessionId, { context: fixture.context, memoryStatusAttempted: false }]]),
    loadConfig: () => loadedMemoryConfig(memorySettings()),
    cwd: () => fixture.cwd,
    env: fixture.env,
    refreshStatus: fakeRefreshMemoryStatus,
    ...(runtime === undefined ? {} : { createRuntime: () => runtime }),
  })
}

describe("memory rpc wiring", () => {
  describe("#given an rpc-capable host with a bound memory session", () => {
    test("#when the session binds #then one memory snapshot reaches rpc clients", async () => {
      const fixture = await createFixture()
      const pi = new RpcFakeExtensionAPI()
      const wiring = wiringFor(fixture)
      const eventCtx = sessionContext(fixture.sessionId)

      wiring.registerStatic(pi, componentContext())
      await wiring.afterBind(pi, fixture.sessionId, fixture.context, eventCtx)

      const events = pi.memoryEvents()
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        schemaVersion: 1,
        identity: fixture.identity,
        journal: { sessionId: fixture.sessionId },
      })
    })

    test("#when memory state changes across the session lifecycle #then each change emits exactly once", async () => {
      const fixture = await createFixture()
      const pi = new RpcFakeExtensionAPI()
      const wiring = wiringFor(fixture)
      const eventCtx = sessionContext(fixture.sessionId)

      wiring.registerStatic(pi, componentContext())
      await wiring.afterBind(pi, fixture.sessionId, fixture.context, eventCtx)
      const afterBind = pi.memoryEvents().length

      await fixture.setBacklog(3)
      await pi.dispatch("tool_result", memoryResult(), eventCtx)
      const afterTool = pi.memoryEvents().length

      await fixture.setBacklog(7)
      await pi.dispatch("agent_settled", {}, eventCtx)

      const events = pi.memoryEvents()
      expect(afterBind).toBe(1)
      expect(afterTool).toBe(2)
      expect(events).toHaveLength(3)
      expect(events.map((event) => event.reflection.backlogSteps)).toEqual([0, 3, 7])
    })

    test("#when unchanged state replays through the lifecycle #then no duplicate snapshot is published", async () => {
      const fixture = await createFixture()
      const pi = new RpcFakeExtensionAPI()
      const wiring = wiringFor(fixture)
      const eventCtx = sessionContext(fixture.sessionId)

      wiring.registerStatic(pi, componentContext())
      await wiring.afterBind(pi, fixture.sessionId, fixture.context, eventCtx)
      await pi.dispatch("tool_result", memoryResult(), eventCtx)
      await pi.dispatch("agent_settled", {}, eventCtx)
      await pi.dispatch("agent_settled", {}, eventCtx)

      expect(pi.memoryEvents()).toHaveLength(1)
    })

    test("#when a reflection launches #then the snapshot reports the active run", async () => {
      const fixture = await createFixture()
      const pi = new RpcFakeExtensionAPI()
      const launches: ReservedRun[] = []
      const runtime = {
        store: {
          evaluate: async () => ({ status: "active", run: reservedRun("run-live") }),
        },
        launch: (run: ReservedRun) => {
          launches.push(run)
        },
        reconcile: async () => {},
      } as unknown as MemoryIdentityRuntime
      const wiring = wiringFor(fixture, runtime)
      const eventCtx = sessionContext(fixture.sessionId)

      wiring.registerStatic(pi, componentContext())
      await wiring.afterBind(pi, fixture.sessionId, fixture.context, eventCtx)
      await pi.dispatch("agent_end", { aborted: false, willRetry: false }, eventCtx)
      await pi.dispatch("agent_settled", {}, eventCtx)

      expect(launches.map((run) => run.runId)).toEqual(["run-live"])
      const latest = pi.memoryEvents().at(-1)
      expect(latest?.reflection.activeRun).toMatchObject({
        runId: "run-live",
        trigger: "manual",
        category: "quick",
      })
    })

    test("#when a live reflection completion is delivered #then the footer and rpc snapshot become idle", async () => {
      const fixture = await createFixture()
      await new GitMemoryRepo({ dir: fixture.context.identityPaths.repo, agentId: fixture.identity }).init()
      const pi = new RpcFakeExtensionAPI()
      const statusCalls: Array<{ key: string; text: string | undefined }> = []
      const handles = new Map<number, () => void>()
      let nextHandle = 1
      const timers = {
        set(callback: () => void) {
          const handle = nextHandle++
          handles.set(handle, callback)
          return handle
        },
        clear(handle: number | ReturnType<typeof setInterval>) {
          handles.delete(handle as number)
        },
      }
      let liveSession: (() => Parameters<typeof recordReflectionCompletion>[2]) | undefined
      let releaseCompletion: (() => void) | undefined
      const completionReleased = new Promise<void>((resolve) => { releaseCompletion = resolve })
      let completionTask: Promise<void> | undefined
      const run = reservedRun("run-live-completed")
      const completion: ReflectionCompletionRecord = {
        schemaVersion: 1,
        runId: run.runId,
        identity: fixture.identity,
        category: "quick",
        conversationIds: [fixture.sessionId],
        trigger: "manual",
        outcome: "merged",
        startedAt: "2026-08-12T00:00:00.000Z",
        finishedAt: "2026-08-12T00:00:01.000Z",
        delivery: { status: "pending" },
      }
      const runtime = {
        store: { evaluate: async () => ({ status: "active", run }) },
        launch: () => {
          completionTask = (async () => {
            await completionReleased
            await recordReflectionCompletion(
              join(fixture.context.identityPaths.reflection, "completions"),
              completion,
              liveSession?.(),
            )
          })()
        },
        reconcile: async () => {},
      } as unknown as MemoryIdentityRuntime
      const wiring = createMemoryWiring({
        sessions: new Map([[fixture.sessionId, { context: fixture.context, memoryStatusAttempted: false }]]),
        loadConfig: () => loadedMemoryConfig(memorySettings()),
        cwd: () => fixture.cwd,
        env: fixture.env,
        refreshStatus: fakeRefreshMemoryStatus,
        footerTimers: timers,
        createRuntime: (_identity, deps) => {
          liveSession = deps.liveSession
          return runtime
        },
      })
      const eventCtx = sessionContext(fixture.sessionId, statusCalls)

      wiring.registerStatic(pi, componentContext())
      await wiring.afterBind(pi, fixture.sessionId, fixture.context, eventCtx)
      await pi.dispatch("agent_end", { aborted: false, willRetry: false }, eventCtx)
      await pi.dispatch("agent_settled", {}, eventCtx)
      expect(handles.size).toBe(1)
      expect(pi.memoryEvents().at(-1)?.reflection.activeRun?.runId).toBe(run.runId)

      releaseCompletion?.()
      await completionTask

      expect(handles.size).toBe(0)
      expect(statusCalls.at(-1)?.text).toMatch(/^mem:agent-test /)
      expect(statusCalls.at(-1)?.text).not.toContain("reflecting")
      expect(pi.memoryEvents().at(-1)?.reflection.activeRun).toBeUndefined()
    })

    test("#when a pending completion is drained at bind #then the same active run becomes idle", async () => {
      const fixture = await createFixture()
      const pi = new RpcFakeExtensionAPI()
      const run = reservedRun("run-bind-completed")
      const runtime = {
        store: { evaluate: async () => ({ status: "active", run }) },
        launch: () => {},
        reconcile: async () => {},
      } as unknown as MemoryIdentityRuntime
      const wiring = wiringFor(fixture, runtime)
      const eventCtx = sessionContext(fixture.sessionId)

      wiring.registerStatic(pi, componentContext())
      await wiring.afterBind(pi, fixture.sessionId, fixture.context, eventCtx)
      await pi.dispatch("agent_end", { aborted: false, willRetry: false }, eventCtx)
      await pi.dispatch("agent_settled", {}, eventCtx)
      expect(pi.memoryEvents().at(-1)?.reflection.activeRun?.runId).toBe(run.runId)

      await recordReflectionCompletion(
        join(fixture.context.identityPaths.reflection, "completions"),
        {
          schemaVersion: 1,
          runId: run.runId,
          identity: fixture.identity,
          category: "quick",
          conversationIds: [fixture.sessionId],
          trigger: "manual",
          outcome: "merged",
          startedAt: "2026-08-12T00:00:00.000Z",
          finishedAt: "2026-08-12T00:00:01.000Z",
          delivery: { status: "pending" },
        },
      )
      await wiring.afterBind(pi, fixture.sessionId, fixture.context, eventCtx)

      expect(pi.memoryEvents().at(-1)?.reflection.activeRun).toBeUndefined()
    })

    test("#when a client pulls the status method #then it receives the live snapshot", async () => {
      const fixture = await createFixture()
      const pi = new RpcFakeExtensionAPI()
      const wiring = wiringFor(fixture)
      const eventCtx = sessionContext(fixture.sessionId)

      wiring.registerStatic(pi, componentContext())
      await wiring.afterBind(pi, fixture.sessionId, fixture.context, eventCtx)
      const handler = pi.rpcHandlers.get(MEMORY_STATUS_RPC_METHOD)

      expect(await handler?.({})).toMatchObject({
        schemaVersion: 1,
        identity: fixture.identity,
        journal: { sessionId: fixture.sessionId },
      })
    })

    test("#when memory tools return repeatedly #then the once-only footer latch still holds", async () => {
      const fixture = await createFixture()
      const pi = new RpcFakeExtensionAPI()
      const wiring = wiringFor(fixture)
      const statusCalls: Array<{ key: string; text: string | undefined }> = []
      const eventCtx = sessionContext(fixture.sessionId, statusCalls)

      wiring.registerStatic(pi, componentContext())
      await pi.dispatch("tool_result", memoryResult(), eventCtx)
      await fixture.setBacklog(2)
      await pi.dispatch("tool_result", memoryResult(), eventCtx)

      expect(statusCalls.filter((call) => call.key === MEMORY_STATUS_KEY)).toHaveLength(1)
    })
  })

  describe("#given an unbound session on an rpc-capable host", () => {
    test("#when lifecycle events fire #then no memory snapshot is published", async () => {
      const fixture = await createFixture()
      const pi = new RpcFakeExtensionAPI()
      const wiring = createMemoryWiring({
        sessions: new Map(),
        loadConfig: () => loadedMemoryConfig(memorySettings()),
        cwd: () => fixture.cwd,
        env: fixture.env,
        refreshStatus: fakeRefreshMemoryStatus,
      })
      const eventCtx = sessionContext("session-unbound")

      wiring.registerStatic(pi, componentContext())
      await pi.dispatch("tool_result", memoryResult(), eventCtx)
      await pi.dispatch("agent_settled", {}, eventCtx)

      expect(pi.memoryEvents()).toEqual([])
    })
  })

  describe("#given a host without rpc support", () => {
    test("#when the session lifecycle runs #then nothing throws and no rpc traffic is recorded", async () => {
      const fixture = await createFixture()
      const pi = new MemoryFakeExtensionAPI()
      const wiring = wiringFor(fixture)
      const eventCtx = sessionContext(fixture.sessionId)

      wiring.registerStatic(pi, componentContext())
      await wiring.afterBind(pi, fixture.sessionId, fixture.context, eventCtx)
      await pi.dispatch("tool_result", memoryResult(), eventCtx)
      await pi.dispatch("agent_settled", {}, eventCtx)

      expect(pi.rpcEvents).toEqual([])
    })
  })
})
