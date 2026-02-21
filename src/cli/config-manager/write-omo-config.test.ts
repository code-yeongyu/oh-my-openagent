import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getProjectOmoConfigPath } from "../../shared"
import type { InstallConfig } from "../types"
import { getOmoConfigPath, initConfigContext, resetConfigContext } from "./config-context"
import { writeOmoConfig } from "./write-omo-config"

describe("writeOmoConfig", () => {
  let tempRoot: string
  let projectDir: string
  let globalConfigDir: string
  let originalCwd: string
  let originalConfigDir: string | undefined

  const baseInstallConfig: InstallConfig = {
    project: false,
    hasClaude: true,
    isMax20: false,
    hasOpenAI: false,
    hasGemini: false,
    hasCopilot: false,
    hasOpencodeZen: false,
    hasZaiCodingPlan: false,
    hasKimiForCoding: false,
  }

  beforeEach(() => {
    tempRoot = join(tmpdir(), `omo-write-config-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    projectDir = join(tempRoot, "project")
    globalConfigDir = join(tempRoot, "global")
    mkdirSync(projectDir, { recursive: true })

    originalCwd = process.cwd()
    originalConfigDir = process.env.OPENCODE_CONFIG_DIR

    process.chdir(projectDir)
    process.env.OPENCODE_CONFIG_DIR = globalConfigDir
    resetConfigContext()
    initConfigContext("opencode", null)
  })

  afterEach(() => {
    process.chdir(originalCwd)

    if (originalConfigDir !== undefined) {
      process.env.OPENCODE_CONFIG_DIR = originalConfigDir
    } else {
      delete process.env.OPENCODE_CONFIG_DIR
    }

    resetConfigContext()

    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("writes project config and creates the .opencode directory when missing", () => {
    // #given no .opencode directory exists yet
    const projectConfigPath = getProjectOmoConfigPath()
    expect(existsSync(join(projectDir, ".opencode"))).toBe(false)

    // #when writing in project mode
    const result = writeOmoConfig(baseInstallConfig, { project: true })

    // #then writes to project config path
    expect(result.success).toBe(true)
    expect(result.configPath).toBe(projectConfigPath)
    expect(existsSync(projectConfigPath)).toBe(true)

    const parsed = JSON.parse(readFileSync(projectConfigPath, "utf-8")) as Record<string, unknown>
    expect(parsed).toHaveProperty("$schema")
  })

  it("does not modify global config when project mode is enabled", () => {
    // #given an existing global config file
    mkdirSync(globalConfigDir, { recursive: true })
    const globalConfigPath = getOmoConfigPath()
    const originalGlobal = '{\n  "custom": "keep"\n}\n'
    writeFileSync(globalConfigPath, originalGlobal)

    // #when writing in project mode
    const result = writeOmoConfig(baseInstallConfig, { project: true })

    // #then global config remains unchanged
    expect(result.success).toBe(true)
    expect(readFileSync(globalConfigPath, "utf-8")).toBe(originalGlobal)
  })

  it("writes to global config when project mode is disabled", () => {
    // #given no existing config files
    const globalConfigPath = getOmoConfigPath()
    const projectConfigPath = getProjectOmoConfigPath()
    expect(existsSync(globalConfigPath)).toBe(false)
    expect(existsSync(projectConfigPath)).toBe(false)

    // #when writing with default mode
    const result = writeOmoConfig(baseInstallConfig)

    // #then writes global config and does not create project config
    expect(result.success).toBe(true)
    expect(result.configPath).toBe(globalConfigPath)
    expect(existsSync(globalConfigPath)).toBe(true)
    expect(existsSync(projectConfigPath)).toBe(false)
  })
})
