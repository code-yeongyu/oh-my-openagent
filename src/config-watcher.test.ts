import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import type { OhMyOpenCodeConfig } from "./config"

// Track log calls for assertions
const logCalls: Array<[string, unknown?]> = []

mock.module("./shared", () => ({
  getOpenCodeConfigDir: (): string => testConfigDir,
  detectConfigFile: (basePath: string): { format: string; path: string } => {
    const jsonPath = `${basePath}.json`
    if (fs.existsSync(jsonPath)) {
      return { format: "json", path: jsonPath }
    }
    return { format: "none", path: basePath }
  },
  log: (message: string, data?: unknown): void => {
    logCalls.push([message, data])
  },
}))

let mockLoadResult: OhMyOpenCodeConfig = {}
let mockLoadShouldThrow = false

mock.module("./plugin-config", () => ({
  loadPluginConfig: (): OhMyOpenCodeConfig => {
    if (mockLoadShouldThrow) {
      throw new Error("Config parse error")
    }
    return mockLoadResult
  },
}))

// Must import AFTER mocks are set up
const { createConfigWatcher } = await import("./config-watcher")

let testConfigDir: string
let testProjectDir: string

beforeEach(() => {
  logCalls.length = 0
  mockLoadShouldThrow = false
  mockLoadResult = {}

  // Create real temp directories and config files
  testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-watcher-test-"))
  testProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-watcher-project-"))

  // Create user-level config file
  const configFilePath = path.join(testConfigDir, "oh-my-opencode.json")
  fs.writeFileSync(configFilePath, JSON.stringify({ agents: {} }))
})

afterEach(() => {
  // Clean up temp directories
  try {
    fs.rmSync(testConfigDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
  try {
    fs.rmSync(testProjectDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
})

afterAll(() => {
  mock.restore()
})

describe("createConfigWatcher", () => {
  test("#given hot_reload enabled and config file exists #when config file changes #then pluginConfig updates in place", async () => {
    // given
    const pluginConfig: OhMyOpenCodeConfig = {
      agents: {
        build: { model: "anthropic/claude-sonnet-4-20250514" },
      },
    }

    mockLoadResult = {
      agents: {
        build: { model: "openai/gpt-5.4" },
      },
    }

    const dispose = createConfigWatcher(testProjectDir, {}, pluginConfig)

    // when — write to config file to trigger fs.watch
    const configFilePath = path.join(testConfigDir, "oh-my-opencode.json")
    fs.writeFileSync(configFilePath, JSON.stringify({ agents: { build: { model: "openai/gpt-5.4" } } }))

    // wait for debounce (300ms) + buffer
    await new Promise((resolve) => setTimeout(resolve, 500))

    // then
    expect(pluginConfig.agents?.build?.model).toBe("openai/gpt-5.4")

    dispose()
  })

  test("#given config file has parse errors #when config changes #then old config is preserved", async () => {
    // given
    const originalConfig: OhMyOpenCodeConfig = {
      agents: {
        build: { model: "anthropic/claude-sonnet-4-20250514" },
      },
    }
    const pluginConfig: OhMyOpenCodeConfig = { ...originalConfig }

    mockLoadShouldThrow = true

    const dispose = createConfigWatcher(testProjectDir, {}, pluginConfig)

    // when — trigger file change
    const configFilePath = path.join(testConfigDir, "oh-my-opencode.json")
    fs.writeFileSync(configFilePath, "{ invalid json }")

    // wait for debounce + buffer
    await new Promise((resolve) => setTimeout(resolve, 500))

    // then — original config should be preserved
    expect(pluginConfig.agents?.build?.model).toBe("anthropic/claude-sonnet-4-20250514")

    // then — error should be logged
    const errorLog = logCalls.find(([msg]) => msg.includes("reload failed"))
    expect(errorLog).toBeDefined()

    dispose()
  })

  test("#given watcher is active #when dispose is called #then watching stops and cleanup logged", () => {
    // given
    const pluginConfig: OhMyOpenCodeConfig = {}
    const dispose = createConfigWatcher(testProjectDir, {}, pluginConfig)

    // when
    dispose()

    // then — dispose log should appear
    const disposeLog = logCalls.find(([msg]) => msg.includes("Disposed"))
    expect(disposeLog).toBeDefined()
  })

  test("#given no config files exist #when createConfigWatcher called #then returns noop dispose", () => {
    // given — use a directory with no config files
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-watcher-empty-"))
    const pluginConfig: OhMyOpenCodeConfig = {}

    // Temporarily override testConfigDir to empty
    const savedDir = testConfigDir
    testConfigDir = emptyDir

    // when
    const dispose = createConfigWatcher(emptyDir, {}, pluginConfig)

    // then — should log "no config files found"
    const noFilesLog = logCalls.find(([msg]) => msg.includes("No config files found"))
    expect(noFilesLog).toBeDefined()

    // then — dispose should not throw
    dispose()

    // cleanup
    testConfigDir = savedDir
    fs.rmSync(emptyDir, { recursive: true, force: true })
  })

  test("#given dispose already called #when dispose called again #then no errors", () => {
    // given
    const pluginConfig: OhMyOpenCodeConfig = {}
    const dispose = createConfigWatcher(testProjectDir, {}, pluginConfig)

    // when — call dispose twice
    dispose()

    // then — second call should not throw
    expect(() => dispose()).not.toThrow()
  })
})
