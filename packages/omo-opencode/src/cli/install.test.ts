import { describe, expect, test, mock, beforeEach, afterEach, spyOn } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { install } from "./install"
import * as astGrepInstall from "./install-ast-grep-sg"
import * as configManager from "./config-manager"
import type { InstallArgs } from "./types"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"

// Mock console methods to capture output
const mockConsoleLog = mock(() => {})
const mockConsoleError = mock(() => {})

describe("install CLI - binary check behavior", () => {
  let tempDir: string
  let originalEnv: string | undefined
  let originalFetch: typeof globalThis.fetch
  let isOpenCodeInstalledSpy: ReturnType<typeof spyOn>
  let getOpenCodeVersionSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    // given temporary config directory
    tempDir = join(tmpdir(), `omo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempDir, { recursive: true })
    originalFetch = globalThis.fetch

    originalEnv = process.env.OPENCODE_CONFIG_DIR
    process.env.OPENCODE_CONFIG_DIR = tempDir

    // Reset config context
    configManager.resetConfigContext()
    configManager.initConfigContext("opencode", null)

    // Capture console output
    console.log = mockConsoleLog
    mockConsoleLog.mockClear()

    spyOn(astGrepInstall, "installAstGrepForOpenCode").mockResolvedValue(undefined)
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
    globalThis.fetch = originalFetch
    mock.restore()
  })

  test("non-TUI mode: should show warning but continue when OpenCode binary not found", async () => {
    // given OpenCode binary is NOT installed
    isOpenCodeInstalledSpy = spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(false)
    getOpenCodeVersionSpy = spyOn(configManager, "getOpenCodeVersion").mockResolvedValue(null)

    // given mock npm fetch
    globalThis.fetch = unsafeTestValue<typeof fetch>(mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "3.0.0" }),
      } as Response)
    ))

    const args: InstallArgs = {
      tui: false,
      claude: "yes",
      openai: "no",
      gemini: "no",
      copilot: "no",
      opencodeZen: "no",
      zaiCodingPlan: "no",
      configScope: "active",
    }

    // when running install
    const exitCode = await install(args)

    // then should return success (0), not failure (1)
    expect(exitCode).toBe(0)

    // then should have printed a warning (not error)
    const allCalls = mockConsoleLog.mock.calls.flat().join("\n")
    expect(allCalls).toContain("[!]") // warning symbol
    expect(allCalls).toContain("OpenCode")
  })

  test("non-TUI mode: should create opencode.json with plugin even when binary not found", async () => {
    // given OpenCode binary is NOT installed
    isOpenCodeInstalledSpy = spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(false)
    getOpenCodeVersionSpy = spyOn(configManager, "getOpenCodeVersion").mockResolvedValue(null)

    // given mock npm fetch
    globalThis.fetch = unsafeTestValue<typeof fetch>(mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "3.0.0" }),
      } as Response)
    ))

    const args: InstallArgs = {
      tui: false,
      claude: "yes",
      openai: "no",
      gemini: "no",
      copilot: "no",
      opencodeZen: "no",
      zaiCodingPlan: "no",
      configScope: "active",
    }

    // when running install
    const exitCode = await install(args)

    // then should create opencode.json
    const configPath = join(tempDir, "opencode.json")
    expect(existsSync(configPath)).toBe(true)

    const config = JSON.parse(readFileSync(configPath, "utf-8"))
    expect(config.plugin).toBeDefined()
    expect(config.plugin.some((p: string) => p.includes("oh-my-openagent"))).toBe(true)
    expect(config.plugin.some((p: string) => p.includes("oh-my-opencode"))).toBe(false)

    // then exit code should be 0 (success)
    expect(exitCode).toBe(0)
  })

  test("non-TUI mode: should still succeed and complete all steps when binary exists", async () => {
    // given OpenCode binary IS installed
    isOpenCodeInstalledSpy = spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(true)
    getOpenCodeVersionSpy = spyOn(configManager, "getOpenCodeVersion").mockResolvedValue("1.4.0")

    // given mock npm fetch
    globalThis.fetch = unsafeTestValue<typeof fetch>(mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "3.0.0" }),
      } as Response)
    ))

    const args: InstallArgs = {
      tui: false,
      claude: "yes",
      openai: "no",
      gemini: "no",
      copilot: "no",
      opencodeZen: "no",
      zaiCodingPlan: "no",
      configScope: "active",
    }

    // when running install
    const exitCode = await install(args)

    // then should return success
    expect(exitCode).toBe(0)

    // then should have printed success (OK symbol)
    const allCalls = mockConsoleLog.mock.calls.flat().join("\n")
    expect(allCalls).toContain("[OK]")
    expect(allCalls).toContain("OpenCode 1.4.0")
  })
})

describe("install CLI - config scope confirmation", () => {
  let customDir: string
  let xdgDir: string
  let originalCustomEnv: string | undefined
  let originalXdgEnv: string | undefined
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    // given a distinct active custom config dir and an isolated default global root
    customDir = join(tmpdir(), `omo-scope-custom-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    xdgDir = join(tmpdir(), `omo-scope-xdg-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(customDir, { recursive: true })
    mkdirSync(xdgDir, { recursive: true })

    originalCustomEnv = process.env.OPENCODE_CONFIG_DIR
    originalXdgEnv = process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = customDir
    process.env.XDG_CONFIG_HOME = xdgDir

    configManager.resetConfigContext()
    configManager.initConfigContext("opencode", null)

    originalFetch = globalThis.fetch
    globalThis.fetch = unsafeTestValue<typeof fetch>(mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "3.0.0" }),
      } as Response)
    ))

    spyOn(astGrepInstall, "installAstGrepForOpenCode").mockResolvedValue(undefined)
  })

  afterEach(() => {
    if (originalCustomEnv !== undefined) {
      process.env.OPENCODE_CONFIG_DIR = originalCustomEnv
    } else {
      delete process.env.OPENCODE_CONFIG_DIR
    }
    if (originalXdgEnv !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXdgEnv
    } else {
      delete process.env.XDG_CONFIG_HOME
    }

    for (const dir of [customDir, xdgDir]) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true })
      }
    }

    globalThis.fetch = originalFetch
    mock.restore()
  })

  function scopeArgs(configScope?: InstallArgs["configScope"]): InstallArgs {
    return {
      tui: false,
      claude: "yes",
      openai: "no",
      gemini: "no",
      copilot: "no",
      opencodeZen: "no",
      zaiCodingPlan: "no",
      ...(configScope !== undefined ? { configScope } : {}),
    }
  }

  function givenOpenCodeBinaryDetected(): void {
    spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(true)
    spyOn(configManager, "getOpenCodeVersion").mockResolvedValue("1.4.0")
  }

  test("non-TUI install without --config-scope fails and writes no registration in either root", async () => {
    // given OpenCode is installed so an unguarded flow would reach the write steps
    givenOpenCodeBinaryDetected()

    // when running install with a distinct custom root but no explicit scope
    const exitCode = await install(scopeArgs())

    // then the install is rejected before any mutation
    expect(exitCode).toBe(1)
    expect(existsSync(join(customDir, "opencode.json"))).toBe(false)
    expect(existsSync(join(customDir, "tui.json"))).toBe(false)
    expect(existsSync(join(xdgDir, "opencode"))).toBe(false)

    // then the error names both effective roots and the required flag
    const allCalls = mockConsoleLog.mock.calls.flat().join("\n")
    expect(allCalls).toContain("--config-scope")
    expect(allCalls).toContain(customDir)
    expect(allCalls).toContain(join(xdgDir, "opencode"))
  })

  test("non-TUI install with --config-scope=global registers only in the default global directory", async () => {
    // given OpenCode is installed
    givenOpenCodeBinaryDetected()

    // when running install scoped to the global root
    const exitCode = await install(scopeArgs("global"))

    // then the plugin lands in the default global directory only
    expect(exitCode).toBe(0)
    const globalConfigPath = join(xdgDir, "opencode", "opencode.json")
    expect(existsSync(globalConfigPath)).toBe(true)
    const config = JSON.parse(readFileSync(globalConfigPath, "utf-8"))
    expect(config.plugin.some((p: string) => p.includes("oh-my-openagent"))).toBe(true)
    expect(existsSync(join(xdgDir, "opencode", "tui.json"))).toBe(true)

    // then the active custom directory stays untouched
    expect(existsSync(join(customDir, "opencode.json"))).toBe(false)
    expect(existsSync(join(customDir, "tui.json"))).toBe(false)
  })

  test("non-TUI install with --config-scope=active registers only in the active custom directory", async () => {
    // given OpenCode is installed
    givenOpenCodeBinaryDetected()

    // when running install scoped to the active custom root
    const exitCode = await install(scopeArgs("active"))

    // then the plugin lands in the active custom directory only
    expect(exitCode).toBe(0)
    const customConfigPath = join(customDir, "opencode.json")
    expect(existsSync(customConfigPath)).toBe(true)
    const config = JSON.parse(readFileSync(customConfigPath, "utf-8"))
    expect(config.plugin.some((p: string) => p.includes("oh-my-openagent"))).toBe(true)
    expect(existsSync(join(customDir, "tui.json"))).toBe(true)

    // then the default global directory stays untouched
    expect(existsSync(join(xdgDir, "opencode"))).toBe(false)
  })

  test("non-TUI install rejects an unsupported --config-scope value", async () => {
    // given OpenCode is installed and an out-of-contract scope value such as "both"
    givenOpenCodeBinaryDetected()

    // when running install with that value
    const exitCode = await install({
      ...scopeArgs(),
      configScope: unsafeTestValue<InstallArgs["configScope"]>("both"),
    })

    // then the install is rejected and nothing is written
    expect(exitCode).toBe(1)
    expect(existsSync(join(customDir, "opencode.json"))).toBe(false)
    expect(existsSync(join(xdgDir, "opencode"))).toBe(false)
    const allCalls = mockConsoleLog.mock.calls.flat().join("\n")
    expect(allCalls).toContain("Invalid --config-scope")
  })
})
