/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import probeFixture from "./__fixtures__/x-search-response.probe.json"
import { createXSearchComponent, resolveXSearchSkillPath } from "./index"
import type { ComponentContext, ComponentLogger, SenpiExtensionAPI } from "../../extension/types"

const tempDirs: string[] = []

function agentDirWith(authJson: unknown | string | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-x-search-agent-"))
  tempDirs.push(dir)
  if (authJson !== undefined) {
    writeFileSync(join(dir, "auth.json"), typeof authJson === "string" ? authJson : JSON.stringify(authJson), "utf8")
  }
  return dir
}

interface FakePi extends SenpiExtensionAPI {
  readonly tools: Array<Record<string, unknown>>
  readonly handlers: Map<string, Array<(payload: unknown, ctx?: unknown) => unknown>>
}

function fakePi(): FakePi {
  const tools: Array<Record<string, unknown>> = []
  const handlers = new Map<string, Array<(payload: unknown, ctx?: unknown) => unknown>>()
  return {
    tools,
    handlers,
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
    },
    registerTool(tool) {
      tools.push(tool)
    },
    registerCommand() {},
    registerFlag() {},
    getFlag: () => undefined,
    sendMessage() {},
    sendUserMessage() {},
  }
}

type LoggerLevel = "debug" | "info" | "warn" | "error"

interface RecordingLogger extends ComponentLogger {
  readonly entries: Array<{ readonly level: LoggerLevel; readonly message: string }>
  readonly messages: string[]
}

/** Records every level; `messages` holds only the levels the default console logger prints. */
function recordingLogger(): RecordingLogger {
  const entries: Array<{ level: LoggerLevel; message: string }> = []
  const record = (level: LoggerLevel) => (message: string) => {
    entries.push({ level, message })
  }
  return {
    entries,
    get messages() {
      return entries.filter((entry) => entry.level !== "debug").map((entry) => entry.message)
    },
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  }
}

function fakeCtx(logger: ComponentLogger = recordingLogger()): ComponentContext {
  return { logger, config: { getFlag: () => undefined } }
}

function fakeEctx(stored: unknown, apiKey: string | undefined = "stored-token") {
  return {
    modelRegistry: {
      authStorage: { get: () => stored },
      getProviderAuth: async () => (apiKey === undefined ? undefined : { auth: { apiKey } }),
    },
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("createXSearchComponent registration gate", () => {
  it("#given a stored xai oauth entry #when registering #then x_search registers once and contributes the x-search skill path", () => {
    const pi = fakePi()
    const component = createXSearchComponent({
      agentDir: agentDirWith({ xai: { type: "oauth", refresh: "r" } }),
      env: {},
    })

    component.register(pi, fakeCtx())

    expect(pi.tools).toHaveLength(1)
    expect(pi.tools[0].name).toBe("x_search")
    expect(pi.tools[0].exposure).toBe("search")

    const discover = pi.handlers.get("resources_discover")
    expect(discover).toHaveLength(1)
    const result = discover?.[0]({ type: "resources_discover" }) as { skillPaths: string[] }
    expect(result.skillPaths).toHaveLength(1)
    expect(result.skillPaths[0].endsWith(join("x-search", "skill", "SKILL.md"))).toBe(true)
  })

  it("#given a connected credential #when registering #then startup stays quiet and the outcome lands on the debug channel only", () => {
    const pi = fakePi()
    const logger = recordingLogger()
    const component = createXSearchComponent({ agentDir: agentDirWith({ xai: { type: "oauth" } }), env: {} })

    component.register(pi, fakeCtx(logger))

    expect(pi.tools).toHaveLength(1)
    expect(logger.messages).toEqual([])
    expect(logger.entries).toEqual([{ level: "debug", message: "x-search registered" }])
  })

  it("#given a packaged plugin layout #when resolving the skill path #then the conditional skills-conditional copy wins", () => {
    const pluginRoot = mkdtempSync(join(tmpdir(), "omo-x-search-plugin-"))
    tempDirs.push(pluginRoot)
    mkdirSync(join(pluginRoot, "skills-conditional", "x-search"), { recursive: true })
    writeFileSync(join(pluginRoot, "skills-conditional", "x-search", "SKILL.md"), "---\nname: x-search\n---\n", "utf8")
    const bundleUrl = pathToFileURL(join(pluginRoot, "extensions", "omo.js")).href

    const resolved = resolveXSearchSkillPath(bundleUrl)

    expect(resolved).toBe(join(pluginRoot, "skills-conditional", "x-search", "SKILL.md"))
  })

  it("#given a packaged plugin layout without skills-conditional #when resolving the skill path #then no path is advertised", () => {
    const pluginRoot = mkdtempSync(join(tmpdir(), "omo-x-search-plugin-bare-"))
    tempDirs.push(pluginRoot)
    mkdirSync(join(pluginRoot, "extensions"), { recursive: true })
    const bundleUrl = pathToFileURL(join(pluginRoot, "extensions", "omo.js")).href

    const resolved = resolveXSearchSkillPath(bundleUrl)

    expect(resolved).toBeUndefined()
  })

  it("#given a connected credential but no resolvable skill #when registering #then the tool registers, no skill path is contributed, and one warning names the gap", () => {
    const pi = fakePi()
    const logger = recordingLogger()
    const component = createXSearchComponent({
      agentDir: agentDirWith({ xai: { type: "oauth" } }),
      env: {},
      resolveSkillPath: () => undefined,
    })

    component.register(pi, fakeCtx(logger))

    expect(pi.tools).toHaveLength(1)
    expect(pi.handlers.has("resources_discover")).toBe(false)
    expect(logger.messages).toEqual(["x-search skill missing: x_search registered without its conditional skill"])
  })

  it("#given no xai entry and no XAI_API_KEY #when registering #then nothing is registered and startup stays quiet", () => {
    const pi = fakePi()
    const logger = recordingLogger()
    const component = createXSearchComponent({ agentDir: agentDirWith({ anthropic: { type: "oauth" } }), env: {} })

    component.register(pi, fakeCtx(logger))

    expect(pi.tools).toHaveLength(0)
    expect(pi.handlers.has("resources_discover")).toBe(false)
    expect(logger.messages).toEqual([])
    expect(logger.entries).toEqual([{ level: "debug", message: "x-search skipped: no xAI credential" }])
  })

  it("#given no stored entry but XAI_API_KEY #when registering #then the tool registers", () => {
    const pi = fakePi()
    const component = createXSearchComponent({ agentDir: agentDirWith(undefined), env: { XAI_API_KEY: "env-token" } })

    component.register(pi, fakeCtx())

    expect(pi.tools).toHaveLength(1)
  })

  it("#given a malformed stored xai entry plus XAI_API_KEY #when registering #then the stored entry owns the decision and nothing registers", () => {
    const pi = fakePi()
    const component = createXSearchComponent({
      agentDir: agentDirWith({ xai: { type: "totally-unknown" } }),
      env: { XAI_API_KEY: "env-token" },
    })

    component.register(pi, fakeCtx())

    expect(pi.tools).toHaveLength(0)
    expect(pi.handlers.has("resources_discover")).toBe(false)
  })

  it("#given an invalid auth.json #when registering #then nothing registers", () => {
    const pi = fakePi()
    const component = createXSearchComponent({ agentDir: agentDirWith("{ not json"), env: { XAI_API_KEY: "env-token" } })

    component.register(pi, fakeCtx())

    expect(pi.tools).toHaveLength(0)
  })

  it("#given no agentDir option #when registering #then the agent home is resolved from the environment", () => {
    const agentDir = agentDirWith({ xai: { type: "api_key" } })
    const pi = fakePi()
    const component = createXSearchComponent({ env: { OMO_CODING_AGENT_DIR: agentDir } })

    component.register(pi, fakeCtx())

    expect(pi.tools).toHaveLength(1)
    expect(component.name).toBe("x-search")
  })
})

describe("createXSearchComponent registered tool execution", () => {
  function registeredTool(fetchImpl: (url: string, init: RequestInit) => Promise<Response>) {
    const pi = fakePi()
    const component = createXSearchComponent({
      agentDir: agentDirWith({ xai: { type: "oauth" } }),
      env: {},
      fetchImpl,
    })
    component.register(pi, fakeCtx())
    return pi.tools[0] as unknown as {
      execute(
        id: string,
        params: unknown,
        signal: AbortSignal | undefined,
        onUpdate: undefined,
        ectx: unknown,
      ): Promise<{ content: Array<{ type: string; text?: string }>; details: unknown; isError?: boolean }>
    }
  }

  it("#given the probe fixture #when the registered tool executes #then it formats results and reports the server queries", async () => {
    const tool = registeredTool(
      async () =>
        new Response(JSON.stringify(probeFixture), { status: 200, headers: { "content-type": "application/json" } }),
    )

    const result = await tool.execute("call-1", { query: "Grok CLI", from_date: "2026-09-01" }, undefined, undefined, fakeEctx({ type: "oauth" }))

    expect(result.content[0].text?.startsWith("x_search results:")).toBe(true)
    expect((result.details as { queries: string[] }).queries[0]).toContain("since:")
  })

  it("#given no resolvable bearer #when the registered tool executes #then it returns the AUTH error", async () => {
    const tool = registeredTool(async () => new Response("{}", { status: 200 }))

    const result = await tool.execute("call-1", { query: "Grok CLI" }, undefined, undefined, fakeEctx(undefined))

    expect(result.content[0].text).toContain("x_search error [AUTH]")
  })
})
