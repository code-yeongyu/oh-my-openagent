import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs"
import { parseJsonc } from "../../shared/jsonc-parser"
import type { InstallConfig } from "../types"
import { resetConfigContext } from "./config-context"

let testConfigPath: string
let testConfigDir: string
let testCounter = 0
let fetchVersionSpy: unknown

beforeEach(async () => {
  testCounter++
  testConfigDir = join(tmpdir(), `test-opencode-${Date.now()}-${testCounter}`)
  testConfigPath = join(testConfigDir, "opencode.jsonc")
  mkdirSync(testConfigDir, { recursive: true })

  process.env.OPENCODE_CONFIG_DIR = testConfigDir
  resetConfigContext()

  const module = await import("./auth-plugins")
  fetchVersionSpy = spyOn(module, "fetchLatestVersion").mockResolvedValue("1.2.3")
})

afterEach(() => {
  try {
    rmSync(testConfigDir, { recursive: true, force: true })
  } catch {}
})

const testConfig: InstallConfig = {
  hasClaude: false,
  isMax20: false,
  hasOpenAI: false,
  hasGemini: true,
  hasCopilot: false,
  hasOpencodeZen: false,
  hasZaiCodingPlan: false,
  hasKimiForCoding: false,
}

describe("addAuthPlugins", () => {
  describe("Test 1: JSONC with commented plugin line", () => {
    it("preserves comment, updates actual plugin array", async () => {
      const content = `{
  // "plugin": ["old-plugin"]
  "plugin": ["existing-plugin"],
  "provider": {}
}`
      writeFileSync(testConfigPath, content, "utf-8")

      const { addAuthPlugins } = await import("./auth-plugins")
      const result = await addAuthPlugins(testConfig)

      expect(result.success).toBe(true)

      const newContent = readFileSync(result.configPath, "utf-8")
      expect(newContent).toContain('// "plugin": ["old-plugin"]')
      expect(newContent).toContain('existing-plugin')
      expect(newContent).toContain('opencode-antigravity-auth')

      const parsed = parseJsonc<Record<string, unknown>>(newContent)
      const plugins = parsed.plugin as string[]
      expect(plugins).toContain('existing-plugin')
      expect(plugins.some((p) => p.startsWith('opencode-antigravity-auth'))).toBe(true)
    })
  })

  describe("Test 2: Plugin array already contains antigravity", () => {
    it("does not add duplicate", async () => {
      const content = `{
  "plugin": ["existing-plugin", "opencode-antigravity-auth"],
  "provider": {}
}`
      writeFileSync(testConfigPath, content, "utf-8")

      const { addAuthPlugins } = await import("./auth-plugins")
      const result = await addAuthPlugins(testConfig)

      expect(result.success).toBe(true)

      const newContent = readFileSync(testConfigPath, "utf-8")
      const parsed = parseJsonc<Record<string, unknown>>(newContent)
      const plugins = parsed.plugin as string[]

      const antigravityCount = plugins.filter((p) => p.startsWith('opencode-antigravity-auth')).length
      expect(antigravityCount).toBe(1)
    })
  })

  describe("Test 3: Backup created before write", () => {
    it("creates .bak file", async () => {
      const originalContent = `{
  "plugin": ["existing-plugin"],
  "provider": {}
}`
      writeFileSync(testConfigPath, originalContent, "utf-8")
      readFileSync(testConfigPath, "utf-8")

      const { addAuthPlugins } = await import("./auth-plugins")
      const result = await addAuthPlugins(testConfig)

      expect(result.success).toBe(true)
      expect(existsSync(`${result.configPath}.bak`)).toBe(true)

      const backupContent = readFileSync(`${result.configPath}.bak`, "utf-8")
      expect(backupContent).toBe(originalContent)
    })
  })

  describe("Test 4: Comment with } character", () => {
    it("preserves comments with special characters", async () => {
      const content = `{
  // This comment has } special characters
  "plugin": ["existing-plugin"],
  "provider": {}
}`
      writeFileSync(testConfigPath, content, "utf-8")

      const { addAuthPlugins } = await import("./auth-plugins")
      const result = await addAuthPlugins(testConfig)

      expect(result.success).toBe(true)

      const newContent = readFileSync(testConfigPath, "utf-8")
      expect(newContent).toContain('// This comment has } special characters')

      expect(() => parseJsonc(newContent)).not.toThrow()
    })
  })

  describe("Test 5: Comment containing 'plugin' string", () => {
    it("must NOT match comment location", async () => {
      const content = `{
  // "plugin": ["fake"]
  "plugin": ["existing-plugin"],
  "provider": {}
}`
      writeFileSync(testConfigPath, content, "utf-8")

      const { addAuthPlugins } = await import("./auth-plugins")
      const result = await addAuthPlugins(testConfig)

      expect(result.success).toBe(true)

      const newContent = readFileSync(testConfigPath, "utf-8")
      expect(newContent).toContain('// "plugin": ["fake"]')

      const parsed = parseJsonc<Record<string, unknown>>(newContent)
      const plugins = parsed.plugin as string[]
      expect(plugins).toContain('existing-plugin')
      expect(plugins).not.toContain('fake')
    })
  })

  describe("Test 6: No existing plugin array", () => {
    it("creates plugin array when none exists", async () => {
      const content = `{
  "provider": {}
}`
      writeFileSync(testConfigPath, content, "utf-8")

      const { addAuthPlugins } = await import("./auth-plugins")
      const result = await addAuthPlugins(testConfig)

      expect(result.success).toBe(true)

      const newContent = readFileSync(result.configPath, "utf-8")

      const parsed = parseJsonc<Record<string, unknown>>(newContent)
      expect(parsed).toHaveProperty('plugin')
      const plugins = parsed.plugin as string[]
      expect(plugins.some((p) => p.startsWith('opencode-antigravity-auth'))).toBe(true)
    })
  })

  describe("Test 7: Post-write validation ensures valid JSONC", () => {
    it("result file must be valid JSONC", async () => {
      const content = `{
  "plugin": ["existing-plugin"],
  "provider": {}
}`
      writeFileSync(testConfigPath, content, "utf-8")

      const { addAuthPlugins } = await import("./auth-plugins")
      const result = await addAuthPlugins(testConfig)

      expect(result.success).toBe(true)

      const newContent = readFileSync(testConfigPath, "utf-8")
      expect(() => parseJsonc(newContent)).not.toThrow()

      const parsed = parseJsonc<Record<string, unknown>>(newContent)
      expect(parsed).toHaveProperty('plugin')
      expect(parsed).toHaveProperty('provider')
    })
  })

  describe("Test 8: Multiple plugins in array", () => {
    it("appends to existing plugins", async () => {
      const content = `{
  "plugin": ["plugin-1", "plugin-2", "plugin-3"],
  "provider": {}
}`
      writeFileSync(testConfigPath, content, "utf-8")

      const { addAuthPlugins } = await import("./auth-plugins")
      const result = await addAuthPlugins(testConfig)

      expect(result.success).toBe(true)

      const newContent = readFileSync(result.configPath, "utf-8")
      const parsed = parseJsonc<Record<string, unknown>>(newContent)
      const plugins = parsed.plugin as string[]

      expect(plugins).toContain('plugin-1')
      expect(plugins).toContain('plugin-2')
      expect(plugins).toContain('plugin-3')
      expect(plugins.some((p) => p.startsWith('opencode-antigravity-auth'))).toBe(true)
    })
  })
})
