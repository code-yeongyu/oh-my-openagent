import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, test } from "bun:test"

import {
  SessionManager,
  createAgentSession,
  createExtensionRuntime,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
  type ResourceLoader,
  type RpcCommand,
  type RpcResponse,
  type ToolDefinition,
} from "@code-yeongyu/senpi"

import { createMinimalSenpiResourceLoader } from "./index"

function acceptCreateAgentSessionOptions(options: CreateAgentSessionOptions): CreateAgentSessionOptions {
  return options
}

function acceptRpcTypes(command: RpcCommand, response: RpcResponse, event: AgentSessionEvent): readonly string[] {
  return [typeof command, typeof response, event.type]
}

describe("pinned Senpi API surface", () => {
  test("#given senpi root exports #when type checked #then task adapter can pass session construction seams", () => {
    // given
    const customTools: ToolDefinition[] = []
    const sessionManager = SessionManager.inMemory()
    const resourceLoader = createMinimalSenpiResourceLoader({ runtime: createExtensionRuntime() })
    const model: CreateAgentSessionOptions["model"] = undefined

    // when
    const options = acceptCreateAgentSessionOptions({
      customTools,
      sessionManager,
      tools: ["read", "bash"],
      model,
      resourceLoader,
    })

    // then
    expect(typeof createAgentSession).toBe("function")
    expect(options.sessionManager).toBe(sessionManager)
    expect(options.resourceLoader).toBe(resourceLoader)
    expect(options.customTools).toEqual([])
    expect(options.tools).toEqual(["read", "bash"])
  })

  test("#given agent dir marker extension #when minimal loader is wired to session options #then no marker extension is discovered", () => {
    // given
    const agentDir = mkdtempSync(join(tmpdir(), "senpi-task-marker-"))
    const markerPath = join(agentDir, "extensions", "marker.js")
    mkdirSync(dirname(markerPath), { recursive: true })
    writeFileSync(markerPath, "globalThis.__senpiTaskMarkerInvoked = true\n", "utf8")
    const loader: ResourceLoader = createMinimalSenpiResourceLoader({
      runtime: createExtensionRuntime(),
    })

    // when
    const options = acceptCreateAgentSessionOptions({
      customTools: [],
      sessionManager: SessionManager.inMemory(),
      tools: [],
      model: undefined,
      resourceLoader: loader,
    })
    expect(options.resourceLoader).toBe(loader)
    const extensions = loader.getExtensions()
    rmSync(agentDir, { recursive: true, force: true })

    // then
    expect(extensions.extensions).toHaveLength(0)
    expect(extensions.errors).toEqual([])
  })

  test("#given minimal resource loader source #when audited #then fake marker factory option is absent", () => {
    // given
    const source = readFileSync(join(import.meta.dir, "senpi", "minimal-resource-loader.ts"), "utf8")

    // when
    const exposesMarkerFactory = source.includes("markerFactory")

    // then
    expect(exposesMarkerFactory).toBe(false)
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
