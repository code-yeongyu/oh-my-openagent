import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, test } from "bun:test"

import {
  SessionManager,
  createAgentSession,
  createExtensionRuntime,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
  type ExtensionFactory,
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

  test("#given minimal resource loader #when fake marker extension exists #then marker factory is not run and no extensions load", () => {
    // given
    let markerRan = false
    const markerFactory: ExtensionFactory = () => {
      markerRan = true
    }
    const loader: ResourceLoader = createMinimalSenpiResourceLoader({
      runtime: createExtensionRuntime(),
      markerFactory,
    })

    // when
    const extensions = loader.getExtensions()

    // then
    expect(markerRan).toBe(false)
    expect(extensions.extensions).toHaveLength(0)
    expect(extensions.errors).toEqual([])
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
