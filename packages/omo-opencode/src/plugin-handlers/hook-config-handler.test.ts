const { afterAll, afterEach, beforeEach, describe, expect, mock, test } = require("bun:test")
const { mkdtempSync, rmSync } = require("node:fs")
const { tmpdir } = require("node:os")
const { join } = require("node:path")
const { restoreModuleMocksForTestFile } = await import("../testing/module-mock-lifecycle")

const mockSetPluginHooksConfigs = mock(() => {})

mock.module("../hooks/claude-code-hooks/config", () => ({
  setPluginHooksConfigs: mockSetPluginHooksConfigs,
}))

const { applyHookConfig } = await import("./hook-config-handler")

afterAll(() => {
  mock.restore()
  restoreModuleMocksForTestFile(import.meta.url)
})

describe("applyHookConfig", () => {
  let originalCwd = ""
  const tempDirs: string[] = []

  beforeEach(() => {
    mockSetPluginHooksConfigs.mockClear()
    originalCwd = process.cwd()
  })

  afterEach(() => {
    mockSetPluginHooksConfigs.mockClear()
    if (process.cwd() !== originalCwd) {
      process.chdir(originalCwd)
    }
    while (tempDirs.length > 0) {
      const tempDir = tempDirs.pop()
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  function createTempCwd(): string {
    const tempDir = mkdtempSync(join(tmpdir(), "omo-hook-config-cwd-"))
    tempDirs.push(tempDir)
    return tempDir
  }

  test("#given hooksConfigs #when applyHookConfig called #then setPluginHooksConfigs receives process.cwd() to align with loader", () => {
    // given
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
    applyHookConfig({ pluginComponents })

    // then
    expect(mockSetPluginHooksConfigs).toHaveBeenCalledTimes(1)
    expect(mockSetPluginHooksConfigs).toHaveBeenCalledWith(
      process.cwd(),
      pluginComponents.hooksConfigs,
    )
  })

  test("#given empty hooksConfigs #when applyHookConfig called #then setPluginHooksConfigs still called with empty array under process.cwd()", () => {
    // given
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
    applyHookConfig({ pluginComponents })

    // then
    expect(mockSetPluginHooksConfigs).toHaveBeenCalledTimes(1)
    expect(mockSetPluginHooksConfigs).toHaveBeenCalledWith(process.cwd(), [])
  })

  test("#given process.cwd() changed before apply #when applyHookConfig called #then setPluginHooksConfigs receives the new cwd, never a stale ctx.directory (#4001)", () => {
    // given
    const pluginComponents = {
      commands: {},
      skills: {},
      agents: {},
      mcpServers: {},
      hooksConfigs: [
        {
          hooks: {
            PreToolUse: [
              {
                matcher: "*",
                hooks: [{ type: "command", command: "echo pre" }],
              },
            ],
          },
        },
      ],
      plugins: [{ name: "worktree-plugin", version: "1.0.0" }],
      errors: [],
    }
    process.chdir(createTempCwd())
    const expectedCwd = process.cwd()

    // when
    applyHookConfig({ pluginComponents })

    // then
    expect(mockSetPluginHooksConfigs).toHaveBeenCalledTimes(1)
    expect(mockSetPluginHooksConfigs).toHaveBeenCalledWith(
      expectedCwd,
      pluginComponents.hooksConfigs,
    )
  })
})

export {}
