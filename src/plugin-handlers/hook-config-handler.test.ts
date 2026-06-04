const { afterEach, beforeEach, describe, expect, mock, test } = require("bun:test")

const mockSetPluginHooksConfigs = mock(() => {})

mock.module("../hooks/claude-code-hooks/config", () => ({
  setPluginHooksConfigs: mockSetPluginHooksConfigs,
}))

const { applyHookConfig } = await import("./hook-config-handler")

describe("applyHookConfig", () => {
  beforeEach(() => {
    mockSetPluginHooksConfigs.mockClear()
  })

  afterEach(() => {
    mockSetPluginHooksConfigs.mockClear()
  })

  test("#given ctx.directory #when applyHookConfig called #then setPluginHooksConfigs receives ctx.directory", () => {
    // given
    const testDirectory = "/test/dir"
    const pluginComponents = {
      commands: {},
      skills: {},
      agents: {},
      mcpServers: {},
      hooksConfigs: [
        {
          hooks: {
            Stop: [
              {
                matcher: "*",
                hooks: [{ type: "command", command: "echo test" }],
              },
            ],
          },
        },
      ],
      plugins: [{ name: "test-plugin", version: "1.0.0" }],
      errors: [],
    }

    // when
    applyHookConfig({
      pluginComponents,
      ctx: { directory: testDirectory },
    })

    // then
    expect(mockSetPluginHooksConfigs).toHaveBeenCalledTimes(1)
    expect(mockSetPluginHooksConfigs).toHaveBeenCalledWith(
      testDirectory,
      pluginComponents.hooksConfigs,
    )
  })

  test("#given empty hooksConfigs #when applyHookConfig called #then setPluginHooksConfigs still called with empty array", () => {
    // given
    const testDirectory = "/another/dir"
    const pluginComponents = {
      commands: {},
      skills: {},
      agents: {},
      mcpServers: {},
      hooksConfigs: [],
      plugins: [],
      errors: [],
    }

    // when
    applyHookConfig({
      pluginComponents,
      ctx: { directory: testDirectory },
    })

    // then
    expect(mockSetPluginHooksConfigs).toHaveBeenCalledTimes(1)
    expect(mockSetPluginHooksConfigs).toHaveBeenCalledWith(testDirectory, [])
  })
})

export {}
