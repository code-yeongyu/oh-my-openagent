import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"

import type { OhMyOpenCodeConfig } from "../config"
import { createConfigHandler } from "./config-handler"
import * as agentConfigHandler from "./agent-config-handler"
import * as commandConfigHandler from "./command-config-handler"
import * as mcpConfigHandler from "./mcp-config-handler"
import * as pluginComponentsLoader from "./plugin-components-loader"
import * as providerConfigHandler from "./provider-config-handler"
import * as shared from "../shared"
import * as toolConfigHandler from "./tool-config-handler"

let logSpy: ReturnType<typeof spyOn>
let loadPluginComponentsSpy: ReturnType<typeof spyOn>
let applyAgentConfigSpy: ReturnType<typeof spyOn>
let applyToolConfigSpy: ReturnType<typeof spyOn>
let applyMcpConfigSpy: ReturnType<typeof spyOn>
let applyCommandConfigSpy: ReturnType<typeof spyOn>
let applyProviderConfigSpy: ReturnType<typeof spyOn>

beforeEach(() => {
  logSpy = spyOn(shared, "log").mockImplementation(() => {})
  loadPluginComponentsSpy = spyOn(
    pluginComponentsLoader,
    "loadPluginComponents",
  ).mockResolvedValue({
    commands: {},
    skills: {},
    agents: {},
    mcpServers: {},
    hooksConfigs: [],
    plugins: [],
    errors: [],
  })
  applyAgentConfigSpy = spyOn(agentConfigHandler, "applyAgentConfig").mockResolvedValue(
    {},
  )
  applyToolConfigSpy = spyOn(toolConfigHandler, "applyToolConfig").mockImplementation(
    () => {},
  )
  applyMcpConfigSpy = spyOn(mcpConfigHandler, "applyMcpConfig").mockResolvedValue()
  applyCommandConfigSpy = spyOn(
    commandConfigHandler,
    "applyCommandConfig",
  ).mockResolvedValue()
  applyProviderConfigSpy = spyOn(
    providerConfigHandler,
    "applyProviderConfig",
  ).mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
  loadPluginComponentsSpy.mockRestore()
  applyAgentConfigSpy.mockRestore()
  applyToolConfigSpy.mockRestore()
  applyMcpConfigSpy.mockRestore()
  applyCommandConfigSpy.mockRestore()
  applyProviderConfigSpy.mockRestore()
})

describe("createConfigHandler formatter pass-through", () => {
  test("preserves formatter object configured in opencode config", async () => {
    // given
    const pluginConfig: OhMyOpenCodeConfig = {}
    const formatterConfig = {
      prettier: {
        command: ["prettier", "--write"],
        extensions: [".ts", ".tsx"],
        environment: {
          PRETTIERD_DEFAULT_CONFIG: ".prettierrc",
        },
      },
      eslint: {
        disabled: false,
        command: ["eslint", "--fix"],
        extensions: [".js", ".ts"],
      },
    }
    const config: Record<string, unknown> = {
      formatter: formatterConfig,
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // when
    await handler(config)

    // then
    expect(config.formatter).toEqual(formatterConfig)
  })

  test("preserves formatter=false configured in opencode config", async () => {
    // given
    const pluginConfig: OhMyOpenCodeConfig = {}
    const config: Record<string, unknown> = {
      formatter: false,
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // when
    await handler(config)

    // then
    expect(config.formatter).toBe(false)
  })
})
