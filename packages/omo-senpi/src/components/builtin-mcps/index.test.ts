/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeOmoSenpiExtension } from "../../extension/compose"
import type { ComponentLogger } from "../../extension/types"
import { createBuiltinMcpsComponent } from "./index"

const GREP_APP_DECLARATION = {
  type: "http",
  url: "https://mcp.grep.app",
  enabled: true,
  auth: false,
  lifecycle: "lazy",
}

const ANONYMOUS_CONTEXT7_DECLARATION = {
  type: "http",
  url: "https://mcp.context7.com/mcp",
  enabled: true,
  auth: false,
  lifecycle: "lazy",
}

function recordingLogger(): ComponentLogger & { readonly entries: Array<{ level: string; message: string; details?: unknown }> } {
  const entries: Array<{ level: string; message: string; details?: unknown }> = []
  return {
    entries,
    info(message, details) {
      entries.push({ level: "info", message, details })
    },
    warn(message, details) {
      entries.push({ level: "warn", message, details })
    },
    error(message, details) {
      entries.push({ level: "error", message, details })
    },
  }
}

function fakeContext(logger: ComponentLogger = recordingLogger()) {
  return {
    logger,
    config: { getFlag: () => undefined },
  }
}

describe("createBuiltinMcpsComponent", () => {
  it("#given no CONTEXT7_API_KEY #when registered #then declares the anonymous lazy context7 and grep_app HTTP servers", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const component = createBuiltinMcpsComponent({ env: {} })

    // when
    await component.register(pi, fakeContext())

    // then
    expect(pi.mcpServers).toEqual([
      { name: "context7", config: ANONYMOUS_CONTEXT7_DECLARATION },
      { name: "grep_app", config: GREP_APP_DECLARATION },
    ])
  })

  it("#given a real CONTEXT7_API_KEY #when registered #then context7 authenticates through bearerTokenEnv without inlining the token", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const component = createBuiltinMcpsComponent({ env: { CONTEXT7_API_KEY: "ctx7sk-live-secret" } })

    // when
    await component.register(pi, fakeContext())

    // then
    expect(pi.mcpServers).toEqual([
      {
        name: "context7",
        config: {
          type: "http",
          url: "https://mcp.context7.com/mcp",
          enabled: true,
          auth: "bearer",
          bearerTokenEnv: "CONTEXT7_API_KEY",
          lifecycle: "lazy",
        },
      },
      { name: "grep_app", config: GREP_APP_DECLARATION },
    ])
    expect(JSON.stringify(pi.mcpServers)).not.toContain("ctx7sk-live-secret")
  })

  it.each([
    { label: "empty", value: "" },
    { label: "whitespace", value: "   " },
    { label: "angle-bracketed", value: "<YOUR_API_KEY>" },
    { label: "hyphenated", value: "your-api-key" },
    { label: "spaced and quoted", value: '"Your API Key"' },
  ])("#given a $label placeholder CONTEXT7_API_KEY #when registered #then context7 stays anonymous", async ({ value }) => {
    // given
    const pi = new FakeExtensionAPI()
    const component = createBuiltinMcpsComponent({ env: { CONTEXT7_API_KEY: value } })

    // when
    await component.register(pi, fakeContext())

    // then
    expect(pi.mcpServers[0]).toEqual({ name: "context7", config: ANONYMOUS_CONTEXT7_DECLARATION })
  })

  it("#given a host without registerMcpServer #when registered #then skips cleanly and logs once", async () => {
    // given
    const logger = recordingLogger()
    const pi = new FakeExtensionAPI()
    // Hosts that predate extension MCP registration expose no such method at all.
    Object.defineProperty(pi, "registerMcpServer", { value: undefined, configurable: true })
    const component = createBuiltinMcpsComponent({ env: {} })

    // when
    const result = component.register(pi, fakeContext(logger))

    // then
    expect(result).toBeUndefined()
    expect(pi.mcpServers).toEqual([])
    expect(logger.entries).toEqual([
      {
        level: "info",
        message: "omo-senpi builtin-mcps skipped: senpi ExtensionAPI does not expose registerMcpServer",
        details: { component: "builtin-mcps" },
      },
    ])
  })

  it("#given omo-senpi-builtin-mcps-disabled #when composed #then no builtin MCP server is declared", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = recordingLogger()
    pi.setFlag("omo-senpi-builtin-mcps-disabled", true)

    // when
    await composeOmoSenpiExtension([createBuiltinMcpsComponent({ env: {} })], { logger })(pi)

    // then
    expect(pi.flags.map((flag) => flag.name)).toEqual([
      "omo-senpi-disabled",
      "omo-senpi-builtin-mcps-disabled",
    ])
    expect(pi.mcpServers).toEqual([])
    expect(logger.entries).toEqual([
      {
        level: "info",
        message: "omo-senpi component disabled by flag",
        details: { component: "builtin-mcps" },
      },
    ])
  })
})
