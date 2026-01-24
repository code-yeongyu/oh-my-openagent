import { describe, expect, test, mock, beforeEach, afterEach, spyOn } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { join, resolve } from "node:path"
import { install } from "./install"
import * as configManager from "./config-manager"
import type { InstallArgs } from "./types"

// Mock console methods to capture output
const mockConsoleLog = mock(() => {})
const mockConsoleError = mock(() => {})

describe("install CLI - binary check behavior", () => {
  let tempDir: string
  let originalEnv: string | undefined
  let isOpenCodeInstalledSpy: ReturnType<typeof spyOn>
  let getOpenCodeVersionSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    // #given temporary config directory
    tempDir = join(tmpdir(), `omo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempDir, { recursive: true })

    originalEnv = process.env.OPENCODE_CONFIG_DIR
    process.env.OPENCODE_CONFIG_DIR = tempDir

    // Reset config context
    configManager.resetConfigContext()
    configManager.initConfigContext("opencode", null)

    // Capture console output
    console.log = mockConsoleLog
    mockConsoleLog.mockClear()
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.OPENCODE_CONFIG_DIR = originalEnv
    } else {
      delete process.env.OPENCODE_CONFIG_DIR
    }

    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }

    isOpenCodeInstalledSpy?.mockRestore()
    getOpenCodeVersionSpy?.mockRestore()
  })

  test("non-TUI mode: should show warning but continue when OpenCode binary not found", async () => {
    // #given OpenCode binary is NOT installed
    isOpenCodeInstalledSpy = spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(false)
    getOpenCodeVersionSpy = spyOn(configManager, "getOpenCodeVersion").mockResolvedValue(null)

    const args: InstallArgs = {
      tui: false,
      claude: "yes",
      openai: "no",
      gemini: "no",
      copilot: "no",
      opencodeZen: "no",
      zaiCodingPlan: "no",
    }

    // #when running install
    const exitCode = await install(args)

    // #then should return success (0), not failure (1)
    expect(exitCode).toBe(0)

    // #then should have printed a warning (not error)
    const allCalls = mockConsoleLog.mock.calls.flat().join("\n")
    expect(allCalls).toContain("[!]") // warning symbol
    expect(allCalls).toContain("OpenCode")
  })

  test("non-TUI mode: should create opencode.json with plugin even when binary not found", async () => {
    // #given OpenCode binary is NOT installed
    isOpenCodeInstalledSpy = spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(false)
    getOpenCodeVersionSpy = spyOn(configManager, "getOpenCodeVersion").mockResolvedValue(null)

    // #given mock npm fetch
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "3.0.0" }),
      } as Response)
    ) as unknown as typeof fetch

    const args: InstallArgs = {
      tui: false,
      claude: "yes",
      openai: "no",
      gemini: "no",
      copilot: "no",
      opencodeZen: "no",
      zaiCodingPlan: "no",
    }

    // #when running install
    const exitCode = await install(args)

    // #then should create opencode.json
    const configPath = join(tempDir, "opencode.json")
    expect(existsSync(configPath)).toBe(true)

    // #then opencode.json should have plugin entry
    const config = JSON.parse(readFileSync(configPath, "utf-8"))
    expect(config.plugin).toBeDefined()
    expect(config.plugin.some((p: string) => p.includes("oh-my-opencode"))).toBe(true)

    // #then exit code should be 0 (success)
    expect(exitCode).toBe(0)
  })

  test("non-TUI mode: should still succeed and complete all steps when binary exists", async () => {
    // #given OpenCode binary IS installed
    isOpenCodeInstalledSpy = spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(true)
    getOpenCodeVersionSpy = spyOn(configManager, "getOpenCodeVersion").mockResolvedValue("1.0.200")

    // #given mock npm fetch
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "3.0.0" }),
      } as Response)
    ) as unknown as typeof fetch

    const args: InstallArgs = {
      tui: false,
      claude: "yes",
      openai: "no",
      gemini: "no",
      copilot: "no",
      opencodeZen: "no",
      zaiCodingPlan: "no",
    }

    // #when running install
    const exitCode = await install(args)

    // #then should return success
    expect(exitCode).toBe(0)

    // #then should have printed success (OK symbol)
    const allCalls = mockConsoleLog.mock.calls.flat().join("\n")
    expect(allCalls).toContain("[OK]")
    expect(allCalls).toContain("OpenCode 1.0.200")
})

  describe("isolated mode", () => {
    let tempDir: string
    let isolatedTempDir: string
    let originalEnv: Record<string, string | undefined>
    let isOpenCodeInstalledSpy: ReturnType<typeof spyOn>
    let getOpenCodeVersionSpy: ReturnType<typeof spyOn>

    beforeEach(() => {
      // #given temporary config directories
      tempDir = join(tmpdir(), `omo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      isolatedTempDir = join(tmpdir(), `omo-iso-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      mkdirSync(tempDir, { recursive: true })
      mkdirSync(isolatedTempDir, { recursive: true })

      originalEnv = {
        OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
        OH_MY_OPENCODE_CONFIG_DIR: process.env.OH_MY_OPENCODE_CONFIG_DIR,
      }
      
      // Set isolated config directory
      process.env.OH_MY_OPENCODE_CONFIG_DIR = isolatedTempDir
      delete process.env.OPENCODE_CONFIG_DIR

      // Reset config context
      configManager.resetConfigContext()
      configManager.initConfigContext("opencode", null)

      // Capture console output
      console.log = mockConsoleLog
      mockConsoleLog.mockClear()
    })

    afterEach(() => {
      // Restore environment variables
      Object.entries(originalEnv).forEach(([key, value]) => {
        if (value !== undefined) {
          process.env[key] = value
        } else {
          delete process.env[key]
        }
      })

      // Clean up temp directories
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true })
      }
      if (existsSync(isolatedTempDir)) {
        rmSync(isolatedTempDir, { recursive: true, force: true })
      }
      
      const defaultIsolatedDir = join(homedir(), ".config", "oh-my-opencode")
      if (existsSync(defaultIsolatedDir)) {
        rmSync(defaultIsolatedDir, { recursive: true, force: true })
      }

      isOpenCodeInstalledSpy?.mockRestore()
      getOpenCodeVersionSpy?.mockRestore()
    })

    test("non-TUI mode with isolated flag should create config in isolated directory", async () => {
      // #given OpenCode binary is installed
      isOpenCodeInstalledSpy = spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(true)
      getOpenCodeVersionSpy = spyOn(configManager, "getOpenCodeVersion").mockResolvedValue("1.0.200")

      // #given mock npm fetch
      globalThis.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ latest: "3.0.0" }),
        } as Response)
      ) as unknown as typeof fetch

      const args: InstallArgs = {
        tui: false,
        claude: "yes",
        openai: "no",
        gemini: "no",
        copilot: "no",
        opencodeZen: "no",
        zaiCodingPlan: "no",
        isolated: true, // Enable isolated mode
      }

      // #when running install with isolated flag
      const exitCode = await install(args)

      // #then should return success
      expect(exitCode).toBe(0)

      // #then should create config in isolated directory, not shared
      const defaultIsolatedDir = join(homedir(), ".config", "oh-my-opencode")
      const isolatedConfigPath = join(defaultIsolatedDir, "opencode.json")
      const sharedConfigPath = join(tempDir, "opencode.json")
      
      expect(existsSync(isolatedConfigPath)).toBe(true)
      expect(existsSync(sharedConfigPath)).toBe(false)

      // #then isolated config should have plugin entry
      const config = JSON.parse(readFileSync(isolatedConfigPath, "utf-8"))
      expect(config.plugin).toBeDefined()
      expect(config.plugin.some((p: string) => p.includes("oh-my-opencode"))).toBe(true)

      // #then oh-my-opencode.json should also be in isolated directory
      const omoConfigPath = join(defaultIsolatedDir, "oh-my-opencode.json")
      expect(existsSync(omoConfigPath)).toBe(true)
    })

    test("non-TUI mode without isolated flag should use OPENCODE_CONFIG_DIR", async () => {
      // #given OpenCode binary is installed
      isOpenCodeInstalledSpy = spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(true)
      getOpenCodeVersionSpy = spyOn(configManager, "getOpenCodeVersion").mockResolvedValue("1.0.200")

      const originalOmoDir = process.env.OH_MY_OPENCODE_CONFIG_DIR
      delete process.env.OH_MY_OPENCODE_CONFIG_DIR
      
      process.env.OPENCODE_CONFIG_DIR = tempDir
      configManager.resetConfigContext()
      configManager.initConfigContext("opencode", null)

      // #given mock npm fetch
      globalThis.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ latest: "3.0.0" }),
        } as Response)
      ) as unknown as typeof fetch

      const args: InstallArgs = {
        tui: false,
        claude: "yes",
        openai: "no",
        gemini: "no",
        copilot: "no",
        opencodeZen: "no",
        zaiCodingPlan: "no",
        isolated: false, // Disable isolated mode
      }

      // #when running install without isolated flag
      const exitCode = await install(args)

      // #then should return success
      expect(exitCode).toBe(0)

      const sharedConfigPath = join(tempDir, "opencode.json")
      const isolatedConfigPath = join(isolatedTempDir, "opencode.json")
      
      expect(existsSync(sharedConfigPath)).toBe(true)
      expect(existsSync(isolatedConfigPath)).toBe(false)
    })

    test("isolated mode ignores OH_MY_OPENCODE_CONFIG_DIR in non-TUI mode", async () => {
      const relativePath = "./test-omo-config"
      process.env.OH_MY_OPENCODE_CONFIG_DIR = relativePath
      configManager.resetConfigContext()
      configManager.initConfigContext("opencode", null)

      isOpenCodeInstalledSpy = spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(true)
      getOpenCodeVersionSpy = spyOn(configManager, "getOpenCodeVersion").mockResolvedValue("1.0.200")

      globalThis.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ latest: "3.0.0" }),
        } as Response)
      ) as unknown as typeof fetch

      const args: InstallArgs = {
        tui: false,
        claude: "yes",
        openai: "no",
        gemini: "no",
        copilot: "no",
        opencodeZen: "no",
        zaiCodingPlan: "no",
        isolated: true,
      }

      const exitCode = await install(args)

      expect(exitCode).toBe(0)

      const defaultIsolatedDir = join(homedir(), ".config", "oh-my-opencode")
      const customPath = resolve(relativePath)
      
      expect(existsSync(join(defaultIsolatedDir, "opencode.json"))).toBe(true)
      expect(existsSync(join(customPath, "opencode.json"))).toBe(false)
    })

    test("handles empty OH_MY_OPENCODE_CONFIG_DIR correctly", async () => {
      // #given empty string OH_MY_OPENCODE_CONFIG_DIR
      process.env.OH_MY_OPENCODE_CONFIG_DIR = ""
      configManager.resetConfigContext()
      configManager.initConfigContext("opencode", null)

      isOpenCodeInstalledSpy = spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(true)
      getOpenCodeVersionSpy = spyOn(configManager, "getOpenCodeVersion").mockResolvedValue("1.0.200")

      globalThis.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ latest: "3.0.0" }),
        } as Response)
      ) as unknown as typeof fetch

      const args: InstallArgs = {
        tui: false,
        claude: "yes",
        openai: "no",
        gemini: "no",
        copilot: "no",
        opencodeZen: "no",
        zaiCodingPlan: "no",
        isolated: true,
      }

      // #when running install with isolated flag and empty env var
      const exitCode = await install(args)

      // #then should return success
      expect(exitCode).toBe(0)

      // #then should fall back to default isolated directory
      const defaultIsolatedDir = join(homedir(), ".config", "oh-my-opencode")
      expect(existsSync(join(defaultIsolatedDir, "opencode.json"))).toBe(true)
    })
  })
})
