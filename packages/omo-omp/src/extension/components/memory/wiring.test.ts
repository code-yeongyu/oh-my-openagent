import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveMemoryIdentity } from "@oh-my-opencode/memory-core"

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

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
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
  const root = await mkdtemp(join(tmpdir(), "omo-memory-footer-wiring-"))
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
