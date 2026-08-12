import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveMemoryIdentity } from "@oh-my-opencode/memory-core"
import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import type { MemoryIdentityRuntime } from "./identity-runtime"

import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { createMemoryComponent, ensureIdentityRuntimeDirs } from "./index"
import {
  MemoryFakeExtensionAPI,
  componentContext,
  loadedMemoryConfig,
  memorySettings,
} from "./memory.test-support"
import {
  MEMORY_STATUS_KEY,
  type MemoryStatusResult,
  type RefreshMemoryStatusInput,
} from "./status"
import { createMemoryWiring } from "./wiring"
import { realpathSync } from "node:fs"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

describe("memory footer wiring", () => {
  test("#given committed memory bound without a visible footer #when memory tools return #then only the first result shows relative age", async () => {
    const fixture = await createFixture()
    const pi = new MemoryFakeExtensionAPI()
    const statusCalls: Array<{ key: string; text: string | undefined }> = []
    createMemoryComponent({
      env: fixture.env,
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      refreshStatus: fakeRefreshMemoryStatus,
      resolveCwd: () => fixture.cwd,
    }).register(pi, componentContext())

    await pi.dispatch("session_start", { type: "session_start" }, sessionContext(fixture.sessionId))
    expect(statusCalls).toEqual([])

    const toolContext = sessionContext(fixture.sessionId, statusCalls)
    await pi.dispatch("tool_result", memoryResult("mcp_omo-memory_memory"), toolContext)
    await pi.dispatch("tool_result", memoryResult("mcp_omo-memory_memory_apply_patch"), toolContext)
    await pi.dispatch("tool_result", memoryResult("read"), toolContext)

    expect(statusCalls).toHaveLength(1)
    expectRelativeStatus(statusCalls[0], fixture.identity)
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, toolContext)
    expect(statusCalls[1]).toEqual({ key: "memory", text: undefined })
  })

  test("#given a completed first-use attempt #when a new session starts #then the once-only footer gate resets", async () => {
    const fixture = await createFixture()
    const pi = new MemoryFakeExtensionAPI()
    const firstStatusCalls: Array<{ key: string; text: string | undefined }> = []
    createMemoryComponent({
      env: fixture.env,
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      refreshStatus: fakeRefreshMemoryStatus,
      resolveCwd: () => fixture.cwd,
    }).register(pi, componentContext())

    const first = sessionContext("session-first", firstStatusCalls)
    await pi.dispatch("session_start", { type: "session_start" }, sessionContext("session-first"))
    await pi.dispatch("tool_result", memoryResult("memory"), first)
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, first)
    expect(firstStatusCalls).toHaveLength(2)
    expectRelativeStatus(firstStatusCalls[0], fixture.identity)
    expect(firstStatusCalls[1]).toEqual({ key: "memory", text: undefined })

    const secondStatusCalls: Array<{ key: string; text: string | undefined }> = []
    const second = sessionContext("session-second", secondStatusCalls)
    await pi.dispatch("session_start", { type: "session_start" }, sessionContext("session-second"))
    await pi.dispatch("tool_result", memoryResult("memory"), second)

    expect(firstStatusCalls).toHaveLength(2)
    expect(secondStatusCalls).toHaveLength(1)
    expectRelativeStatus(secondStatusCalls[0], fixture.identity)
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, second)
  })

  test("#given bind reconciliation is pending #when a footer publishes #then bind completion does not erase it", async () => {
    const fixture = await createFixture()
    const pi = new MemoryFakeExtensionAPI()
    const statusCalls: Array<{ key: string; text: string | undefined }> = []
    const wiring = createMemoryWiring({
      sessions: new Map([[
        fixture.sessionId,
        { context: fixture.context, memoryStatusAttempted: false },
      ]]),
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      cwd: () => fixture.cwd,
      env: fixture.env,
      refreshStatus: fakeRefreshMemoryStatus,
    })
    const eventCtx = sessionContext(
      fixture.sessionId,
      statusCalls,
      [{ type: "custom" }],
    )

    wiring.clearStatus(eventCtx)
    const bindCompletion = wiring.afterBind(pi, fixture.sessionId, fixture.context, eventCtx)
    statusCalls.push({ key: "memory", text: `mem:${fixture.identity} 1m ago` })
    await bindCompletion

    expect(statusCalls).toEqual([
      { key: "memory", text: undefined },
      { key: "memory", text: `mem:${fixture.identity} 1m ago` },
    ])
  })

  test("#given a failed first memory result #when a later call succeeds #then the footer waits for success", async () => {
    const fixture = await createFixture()
    const pi = new MemoryFakeExtensionAPI()
    const statusCalls: Array<{ key: string; text: string | undefined }> = []
    createMemoryComponent({
      env: fixture.env,
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      refreshStatus: fakeRefreshMemoryStatus,
      resolveCwd: () => fixture.cwd,
    }).register(pi, componentContext())

    await pi.dispatch("session_start", { type: "session_start" }, sessionContext(fixture.sessionId))
    const toolContext = sessionContext(fixture.sessionId, statusCalls)
    await pi.dispatch("tool_result", memoryResult("memory", true), toolContext)
    expect(statusCalls).toEqual([])

    await pi.dispatch("tool_result", memoryResult("memory"), toolContext)
    expect(statusCalls).toHaveLength(1)
    expectRelativeStatus(statusCalls[0], fixture.identity)
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, toolContext)
  })
})

async function createFixture(): Promise<{
  readonly cwd: string
  readonly env: { readonly OMO_MEMORY_HOME: string }
  readonly context: MemoryIdentityContext
  readonly identity: string
  readonly sessionId: string
}> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-footer-wiring-")))
  roots.push(root)
  const cwd = join(root, "project")
  const env = { OMO_MEMORY_HOME: join(root, "memory") }
  const identity = resolveMemoryIdentity("auto", cwd, env)
  const sessionId = "session-memory-footer"
  await ensureIdentityRuntimeDirs(identity.paths)
  await mkdir(join(identity.paths.transcripts, sessionId), { recursive: true })
  const context = createMemoryIdentityContext({
    identity: identity.id,
    identityPaths: identity.paths,
    binding: { identity: identity.id, repoPathHash: "hash", boundAt: 1 },
  })
  return { cwd, env, context, identity: identity.id, sessionId }
}

async function fakeRefreshMemoryStatus(
  input: RefreshMemoryStatusInput,
): Promise<MemoryStatusResult> {
  if (input.showFooter === false) {
    return { notified: false, footerShown: false }
  }
  input.ui.setStatus(MEMORY_STATUS_KEY, `mem:${input.context.identity} 1m ago`)
  return { notified: false, footerShown: true }
}

function memoryResult(toolName: string, isError = false): Record<string, unknown> {
  return {
    type: "tool_result",
    toolName,
    isError,
    input: {},
    content: [{ type: "text", text: "done" }],
  }
}

function sessionContext(
  sessionId: string,
  statusCalls?: Array<{ key: string; text: string | undefined }>,
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
      ...(statusCalls === undefined
        ? {}
        : {
            setStatus: (key: string, text: string | undefined) => {
              statusCalls.push({ key, text })
            },
          }),
    },
  }
}

function expectRelativeStatus(
  call: { key: string; text: string | undefined } | undefined,
  identity: string,
): void {
  expect(call?.key).toBe("memory")
  expect(call?.text).toMatch(new RegExp(`^mem:${identity} (?:just now|[1-9]\\d*[mhd] ago)$`))
}

async function reflectionFixture(settings: ReturnType<typeof memorySettings> | undefined): Promise<{
  readonly pi: MemoryFakeExtensionAPI
  readonly evaluations: { count: number }
}> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-wiring-")))
  roots.push(root)
  const identity = createMemoryIdentityContext({
    identity: "agent-test",
    identityPaths: buildIdentityPaths(root, "agent-test"),
    binding: { identity: "agent-test", repoPathHash: "hash", boundAt: 1 },
  })
  const sessions = new Map([["session-1", { context: identity }]])
  const evaluations = { count: 0 }
  const runtime = {
    store: {
      evaluate: async () => {
        evaluations.count += 1
        return null
      },
    },
    launch: () => {},
  } as unknown as MemoryIdentityRuntime
  const pi = new MemoryFakeExtensionAPI()
  createMemoryWiring({
    sessions,
    loadConfig: () => settings === undefined
      ? { config: {}, diagnostics: [], layers: [], sources: [] }
      : loadedMemoryConfig(settings),
    cwd: () => root,
    env: {},
    createRuntime: () => runtime,
  }).registerStatic(pi, componentContext())
  return { pi, evaluations }
}

const eventCtx = {
  sessionManager: {
    getSessionId: () => "session-1",
    getEntries: () => [],
  },
}

describe("memory wiring reflection completion delivery", () => {
  describe("#given a pending completion and a bound session with a real UI callback", () => {
    describe("#when afterBind drains the identity completion directory", () => {
      test("#then the callback receives the completion notification payload and level", async () => {
        // given
        const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-wiring-notify-")))
        roots.push(root)
        const identity = createMemoryIdentityContext({
          identity: "agent-notify",
          identityPaths: buildIdentityPaths(root, "agent-notify"),
          binding: { identity: "agent-notify", repoPathHash: "hash", boundAt: 1 },
        })
        const completionsDir = join(identity.identityPaths.reflection, "completions")
        await mkdir(completionsDir, { recursive: true })
        await writeFile(join(completionsDir, "run-notify.json"), `${JSON.stringify({
          schemaVersion: 1,
          runId: "run-notify",
          identity: "agent-notify",
          category: "quick",
          conversationIds: ["past-session"],
          trigger: "manual",
          outcome: "failed",
          reason: "child_exit",
          detail: "fixture failure",
          startedAt: "2026-08-12T00:00:00.000Z",
          finishedAt: new Date().toISOString(),
          delivery: { status: "pending" },
        })}\n`)
        const sessionId = "current-session"
        const notifications: Array<{ message: string; level: string }> = []
        const runtime = {
          reconcile: async () => {},
        } as unknown as MemoryIdentityRuntime
        const wiring = createMemoryWiring({
          sessions: new Map([[sessionId, { context: identity }]]),
          loadConfig: () => loadedMemoryConfig(memorySettings()),
          cwd: () => root,
          env: {},
          createRuntime: () => runtime,
        })
        const pi = new MemoryFakeExtensionAPI()
        const bindContext = {
          sessionManager: {
            getSessionId: () => sessionId,
            getEntries: () => [],
          },
          ui: {
            setStatus: () => {},
            notify: (message: string, level: string) => notifications.push({ message, level }),
          },
        }

        // when
        await wiring.afterBind(pi, sessionId, identity, bindContext)

        // then
        expect(notifications).toEqual([{
          message: "Delivered 1 memory reflection completions; 1 need attention.",
          level: "warning",
        }])
      })
    })
  })
})

describe("memory wiring reflection policy", () => {
  test("#given reflection disabled for the bound agent #when an automatic settle arrives #then no reservation evaluation starts", async () => {
    const settings = memorySettings()
    settings.agents["agent-test"] = { reflection: { enabled: false } }
    const { pi, evaluations } = await reflectionFixture(settings)

    await pi.dispatch("agent_end", { aborted: false, willRetry: false }, eventCtx)
    await pi.dispatch("agent_settled", {}, eventCtx)

    expect(evaluations.count).toBe(0)
  })

  test("#given the memory block is absent #when an automatic settle arrives #then schema-default reflection remains enabled", async () => {
    const { pi, evaluations } = await reflectionFixture(undefined)

    await pi.dispatch("agent_end", { aborted: false, willRetry: false }, eventCtx)
    await pi.dispatch("agent_settled", {}, eventCtx)

    expect(evaluations.count).toBe(1)
  })
})

/**
 * Drives the real wiring with an injected timer set, so a reflection launch actually starts the
 * footer animation. The spinner must be genuinely running before a stop path is asserted -
 * otherwise "zero live handles" passes for the trivial reason that nothing ever started.
 */
async function liveFooterHarness(): Promise<{
  readonly wiring: ReturnType<typeof createMemoryWiring>
  readonly statusCalls: Array<{ key: string; text: string | undefined }>
  readonly eventCtx: unknown
  readonly sessionId: string
  readonly liveTimers: () => number
  readonly advanceFrames: (ticks: number) => void
  readonly startReflection: () => Promise<void>
  readonly pi: MemoryFakeExtensionAPI
}> {
  const fixture = await createFixture()
  const pi = new MemoryFakeExtensionAPI()
  const statusCalls: Array<{ key: string; text: string | undefined }> = []
  const handles = new Map<number, () => void>()
  let nextHandle = 1
  const timers = {
    set(callback: () => void) {
      const handle = nextHandle
      nextHandle += 1
      handles.set(handle, callback)
      return handle
    },
    clear(handle: number | ReturnType<typeof setInterval>) {
      handles.delete(handle as number)
    },
  }
  const runtime = {
    store: {
      evaluate: async () => ({
        status: "active",
        run: {
          runId: "run-live-1",
          request: { trigger: "settled", conversationIds: [fixture.sessionId], snapshots: [] },
        },
      }),
    },
    launch: () => {},
    reconcile: async () => {},
  } as unknown as MemoryIdentityRuntime
  const wiring = createMemoryWiring({
    sessions: new Map([[fixture.sessionId, { context: fixture.context, memoryStatusAttempted: false }]]),
    loadConfig: () => loadedMemoryConfig(memorySettings()),
    cwd: () => fixture.cwd,
    env: fixture.env,
    refreshStatus: fakeRefreshMemoryStatus,
    footerTimers: timers,
    createRuntime: () => runtime,
  })
  const eventCtx = sessionContext(fixture.sessionId, statusCalls)
  wiring.registerStatic(pi, componentContext())

  return {
    wiring,
    statusCalls,
    eventCtx,
    sessionId: fixture.sessionId,
    pi,
    liveTimers: () => handles.size,
    advanceFrames(ticks) {
      for (let tick = 0; tick < ticks; tick += 1) {
        for (const callback of [...handles.values()]) callback()
      }
    },
    async startReflection() {
      await pi.dispatch("agent_end", { aborted: false, willRetry: false }, eventCtx)
      await pi.dispatch("agent_settled", {}, eventCtx)
    },
  }
}

describe("memory footer live wiring", () => {
  test("#given a spinner animating mid-session #when the footer is cleared #then the interval is released and nothing repaints", async () => {
    const harness = await liveFooterHarness()

    await harness.startReflection()
    harness.advanceFrames(2)

    // Non-vacuity: the animation is genuinely live before clearStatus is exercised.
    expect(harness.liveTimers()).toBe(1)
    expect(harness.statusCalls.some((call) => call.text?.includes("reflecting") === true)).toBe(true)

    harness.wiring.clearStatus(harness.eventCtx)
    const afterClear = harness.statusCalls.length

    expect(harness.liveTimers()).toBe(0)
    harness.advanceFrames(10)
    expect(harness.statusCalls).toHaveLength(afterClear)
    expect(harness.statusCalls.at(-1)).toEqual({ key: "memory", text: undefined })
  })

  test("#given a spinner animating mid-session #when the session shuts down #then the animation interval is released", async () => {
    const harness = await liveFooterHarness()

    await harness.startReflection()
    harness.advanceFrames(2)

    expect(harness.liveTimers()).toBe(1)

    await harness.wiring.onSessionShutdown({
      reason: "quit",
      sessionId: harness.sessionId,
      deadlineAt: Date.now() + 1_000,
      now: () => Date.now(),
    })
    const afterShutdown = harness.statusCalls.length

    expect(harness.liveTimers()).toBe(0)
    harness.advanceFrames(10)
    expect(harness.statusCalls).toHaveLength(afterShutdown)
  })
})
