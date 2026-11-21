import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, test } from "bun:test"

import {
  SessionManager,
  createAgentSession,
  createExtensionRuntime,
  DefaultResourceLoader,
  defineTool,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
  type ResourceLoader,
  type RpcCommand,
  type RpcResponse,
  type ToolDefinition,
} from "@code-yeongyu/senpi"

import * as senpiTask from "./index"
import { createMinimalSenpiResourceLoader } from "./index"
import type { AgentResolutionResult, ResolveAgentOptions } from "./index"

// The marker test boots two real stages (loader reload, then session boot).
// On Windows either stage can hang until the runner-wide 30 s ceil, and the
// timeout names no stage (#12957). Bound each stage below the ceil so a hang
// fails fast with the stage that did not complete.
const STAGE_TIMEOUT_MS = 15_000

function withStageTimeout<T>(promise: Promise<T>, stage: string, timeoutMs = STAGE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`senpi-api-tripwire: timed out waiting for ${stage} after ${timeoutMs}ms`))
    }, timeoutMs)
  })
  // Clear the timer once the race settles, whichever side won.
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

function acceptRpcTypes(command: RpcCommand, response: RpcResponse, event: AgentSessionEvent): readonly string[] {
  return [typeof command, typeof response, event.type]
}

describe("pinned Senpi API surface", () => {
  test("#given the senpi-task root import #when curated agent exports are used #then values and result types resolve", () => {
    // given
    const options: ResolveAgentOptions = { modelOverride: "openai/explicit" }

    // when
    const result: AgentResolutionResult = senpiTask.resolveAgent(
      "explore",
      senpiTask.BUILTIN_AGENTS,
      undefined,
      options,
    )

    // then
    expect(senpiTask.BUILTIN_AGENT_DEFAULTS).toHaveLength(7)
    expect(result.kind).toBe("resolved")
  })

  test("#given senpi root exports #when type checked #then task adapter can pass session construction seams", () => {
    // given
    const customTools: ToolDefinition[] = []
    const sessionManager = SessionManager.inMemory()
    const resourceLoader = createMinimalSenpiResourceLoader({ runtime: createExtensionRuntime() })
    const model: CreateAgentSessionOptions["model"] = undefined

    // when
    const options = {
      customTools,
      sessionManager,
      tools: ["read", "bash"],
      model,
      resourceLoader,
    } satisfies CreateAgentSessionOptions

    // then
    expect(typeof createAgentSession).toBe("function")
    expect(options.sessionManager).toBe(sessionManager)
    expect(options.resourceLoader).toBe(resourceLoader)
    expect(options.customTools).toEqual([])
    expect(options.tools).toEqual(["read", "bash"])
  })

  test("#given the pinned senpi barrel #when defineTool is applied #then it is the identity helper", () => {
    // given / when / then - the task tool factories return their definitions unwrapped on the
    // strength of defineTool being identity; pin that so a senpi bump that changes this trips the
    // tripwire instead of silently changing tool construction.
    const sample: ToolDefinition = {
      name: "sample",
      label: "Sample",
      description: "sample",
      parameters: undefined as never,
      execute: () => Promise.resolve(undefined as never),
    }
    expect(defineTool(sample)).toBe(sample)
  })

  test("#given agent dir marker extension #when session boots with minimal loader #then marker factory is not invoked", async () => {
    // given
    const rootDir = mkdtempSync(join(tmpdir(), "senpi-task-marker-"))
    const agentDir = join(rootDir, "agent")
    const cwd = join(rootDir, "project")
    const markerPath = join(agentDir, "extensions", "marker.js")
    const markerInvokedPath = join(rootDir, "marker-invoked")
    mkdirSync(cwd, { recursive: true })
    mkdirSync(dirname(markerPath), { recursive: true })
    writeFileSync(
      markerPath,
      `import { writeFileSync } from "node:fs"\nexport default function () { writeFileSync(${JSON.stringify(markerInvokedPath)}, "invoked", "utf8") }\n`,
      "utf8",
    )
    const defaultLoader = new DefaultResourceLoader({ cwd, agentDir })
    await withStageTimeout(defaultLoader.reload(), "loader reload")
    expect(existsSync(markerInvokedPath)).toBe(true)
    rmSync(markerInvokedPath, { force: true })
    const loader: ResourceLoader = createMinimalSenpiResourceLoader({
      runtime: createExtensionRuntime(),
    })

    // when
    try {
      const result = await withStageTimeout(
        createAgentSession({
          agentDir,
          cwd,
          customTools: [],
          sessionManager: SessionManager.inMemory(),
          tools: [],
          model: undefined,
          resourceLoader: loader,
          scopedModels: [],
          favoriteModels: [],
        }),
        "session boot",
      )

      // then
      expect(existsSync(markerInvokedPath)).toBe(false)
      expect(result.extensionsResult.extensions).toHaveLength(0)
      expect(result.extensionsResult.errors).toEqual([])
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })

  test("#given a promise that never settles #when raced with a stage timeout #then it rejects naming the stage", async () => {
    // given
    const hung = new Promise<never>(() => {})

    // when
    const failure = await withStageTimeout(hung, "loader reload", 50).then(
      () => null,
      (error: unknown) => error,
    )

    // then
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain("loader reload")
    expect((failure as Error).message).toContain("50ms")
  })

  test("#given a promise that settles fast #when raced with a stage timeout #then it resolves with its value", async () => {
    // given / when
    const value = await withStageTimeout(Promise.resolve("ok"), "session boot", 1000)

    // then
    expect(value).toBe("ok")
  })

  test("#given pinned artifact #when package metadata and rpc entry are checked #then expected public contract exists", async () => {
    // given
    const packageRoot = dirname(dirname(Bun.resolveSync("@code-yeongyu/senpi", import.meta.dir)))
    const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))
    const command: RpcCommand = { type: "get_commands" }
    const response: RpcResponse = {
      type: "response",
      command: "get_commands",
      success: true,
      data: { commands: [] },
    }
    const event: AgentSessionEvent = { type: "auto_retry_end", success: true, attempt: 1 }

    // when
    const rpcEntry = Bun.resolveSync("@code-yeongyu/senpi/rpc-entry", import.meta.dir)
    const values = acceptRpcTypes(command, response, event)

    // then
    expect(SessionManager.inMemory()).toBeInstanceOf(SessionManager)
    expect(createExtensionRuntime().flagValues).toBeInstanceOf(Map)
    expect(rpcEntry).toContain("rpc-entry.js")
    expect(packageJson.piConfig.name).toBe("senpi")
    expect(values).toEqual(["object", "object", "auto_retry_end"])
  })
})
