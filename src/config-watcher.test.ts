import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import type { OhMyOpenCodeConfig } from "./config"

const logCalls: Array<[string, unknown?]> = []
let testConfigDir: string

mock.module("./shared", () => ({
  getOpenCodeConfigDir: (): string => testConfigDir,
  detectConfigFile: (basePath: string): { format: string; path: string } => {
    const jsoncPath = `${basePath}.jsonc`
    const jsonPath = `${basePath}.json`
    if (fs.existsSync(jsoncPath)) {
      return { format: "jsonc", path: jsoncPath }
    }
    if (fs.existsSync(jsonPath)) {
      return { format: "json", path: jsonPath }
    }
    return { format: "none", path: jsonPath }
  },
  log: (message: string, data?: unknown): void => {
    logCalls.push([message, data])
  },
}))

mock.module("./shared/plugin-identity", () => ({
  CONFIG_BASENAME: "oh-my-openagent",
  LEGACY_CONFIG_BASENAME: "oh-my-opencode",
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

const { createConfigWatcher } = await import("./config-watcher")

let testProjectDir: string

beforeEach(() => {
  logCalls.length = 0
  mockLoadShouldThrow = false
  mockLoadResult = {}

  testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-watcher-test-"))
  testProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-watcher-project-"))

  const configFilePath = path.join(testConfigDir, "oh-my-openagent.json")
  fs.writeFileSync(configFilePath, JSON.stringify({ agents: {} }))
})

afterEach(() => {
  try {
    fs.rmSync(testConfigDir, { recursive: true, force: true })
  } catch {}
  try {
    fs.rmSync(testProjectDir, { recursive: true, force: true })
  } catch {}
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

    // when
    const configFilePath = path.join(testConfigDir, "oh-my-openagent.json")
    fs.writeFileSync(configFilePath, JSON.stringify({ agents: { build: { model: "openai/gpt-5.4" } } }))

    // then
    await new Promise((resolve) => setTimeout(resolve, 500))
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

    // when
    const configFilePath = path.join(testConfigDir, "oh-my-openagent.json")
    fs.writeFileSync(configFilePath, "{ invalid json }")

    // then
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(pluginConfig.agents?.build?.model).toBe("anthropic/claude-sonnet-4-20250514")

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

    // then
    const disposeLog = logCalls.find(([msg]) => msg.includes("Disposed"))
    expect(disposeLog).toBeDefined()
  })

  test("#given no config files exist #when createConfigWatcher called #then returns noop dispose", () => {
    // given
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-watcher-empty-"))
    const pluginConfig: OhMyOpenCodeConfig = {}

    const savedDir = testConfigDir
    testConfigDir = emptyDir

    // when
    const dispose = createConfigWatcher(emptyDir, {}, pluginConfig)

    // then
    const noFilesLog = logCalls.find(([msg]) => msg.includes("No config files found"))
    expect(noFilesLog).toBeDefined()

    dispose()

    testConfigDir = savedDir
    fs.rmSync(emptyDir, { recursive: true, force: true })
  })

  test("#given config section removed from file #when config reloads #then stale keys are deleted from pluginConfig", async () => {
    // given
    const pluginConfig: OhMyOpenCodeConfig = {
      agents: {
        build: { model: "anthropic/claude-sonnet-4-20250514" },
      },
      categories: {
        quick: { model: "openai/gpt-4.1-mini" },
      },
    }

    mockLoadResult = {
      agents: {
        build: { model: "openai/gpt-5.4" },
      },
    }

    const dispose = createConfigWatcher(testProjectDir, {}, pluginConfig)

    // when
    const configFilePath = path.join(testConfigDir, "oh-my-openagent.json")
    fs.writeFileSync(configFilePath, JSON.stringify({ agents: { build: { model: "openai/gpt-5.4" } } }))

    // then
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(pluginConfig.agents?.build?.model).toBe("openai/gpt-5.4")
    expect(pluginConfig.categories).toBeUndefined()
    expect("categories" in pluginConfig).toBe(false)

    dispose()
  })

  test("#given dispose already called #when dispose called again #then no errors", () => {
    // given
    const pluginConfig: OhMyOpenCodeConfig = {}
    const dispose = createConfigWatcher(testProjectDir, {}, pluginConfig)

    // when
    dispose()

    // then
    expect(() => dispose()).not.toThrow()
  })
})
