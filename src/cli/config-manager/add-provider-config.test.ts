import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { modifyProviderInJsonc } from "./jsonc-provider-editor"
import { parseJsonc } from "../../shared/jsonc-parser"
import { addProviderConfig } from "./add-provider-config"
import { resetConfigContext } from "./config-context"
import type { InstallConfig } from "../types"
import { createEmptyLocalProviderModels } from "../local-model-capabilities"

describe("modifyProviderInJsonc", () => {
  describe("Test 1: Basic JSONC with existing provider", () => {
    it("replaces provider value, preserves comments and other keys", () => {
      // given
      const content = `{
  // my config
  "provider": { "openai": {} },
  "plugin": ["foo"]
}`
      const newProviderValue = { google: { name: "Google" } }

      // when
      const result = modifyProviderInJsonc(content, newProviderValue)

      // then
      expect(result).toContain('"google"')
      expect(result).toContain('"plugin": ["foo"]')
      expect(result).toContain('// my config')

      // Post-write validation
      const parsed = parseJsonc<Record<string, unknown>>(result)
      expect(parsed).toHaveProperty('plugin')
      expect(parsed).toHaveProperty('provider')
    })
  })

  describe("Test 2: Comment containing '}' inside provider block", () => {
    it("must NOT corrupt file", () => {
      // given
      const content = `{
  "provider": {
    // } this brace should be ignored
    "openai": {}
  },
  "other": 1
}`
      const newProviderValue = { google: { name: "Google" } }

      // when
      const result = modifyProviderInJsonc(content, newProviderValue)

      // then
      expect(result).toContain('"other"')

      // Post-write validation
      const parsed = parseJsonc<Record<string, unknown>>(result)
      expect(parsed).toHaveProperty('other')
      expect(parsed.other).toBe(1)
    })
  })

  describe("Test 3: Comment containing '\"provider\"' before real key", () => {
    it("must NOT match wrong location", () => {
      // given
      const content = `{
  // "provider": { "example": true }
  "provider": { "openai": {} },
  "other": 1
}`
      const newProviderValue = { google: { name: "Google" } }

      // when
      const result = modifyProviderInJsonc(content, newProviderValue)

      // then
      expect(result).toContain('"other"')

      // Post-write validation
      const parsed = parseJsonc<Record<string, unknown>>(result)
      expect(parsed).toHaveProperty('other')
      expect(parsed.other).toBe(1)
      expect(parsed.provider).toHaveProperty('google')
    })
  })

  describe("Test 4: Comment containing '{' inside provider", () => {
    it("must NOT mess up depth", () => {
      // given
      const content = `{
  "provider": {
    // { unmatched brace in comment
    "openai": {}
  },
  "other": 1
}`
      const newProviderValue = { google: { name: "Google" } }

      // when
      const result = modifyProviderInJsonc(content, newProviderValue)

      // then
      expect(result).toContain('"other"')

      // Post-write validation
      const parsed = parseJsonc<Record<string, unknown>>(result)
      expect(parsed).toHaveProperty('other')
      expect(parsed.other).toBe(1)
    })
  })

  describe("Test 5: No existing provider key", () => {
    it("inserts provider without corrupting", () => {
      // given
      const content = `{
  // config comment
  "plugin": ["foo"]
}`
      const newProviderValue = { google: { name: "Google" } }

      // when
      const result = modifyProviderInJsonc(content, newProviderValue)

      // then
      expect(result).toContain('"provider"')
      expect(result).toContain('"plugin"')
      expect(result).toContain('foo')
      expect(result).toContain('// config comment')

      // Post-write validation
      const parsed = parseJsonc<Record<string, unknown>>(result)
      expect(parsed).toHaveProperty('provider')
      expect(parsed).toHaveProperty('plugin')
      expect(parsed.plugin).toEqual(['foo'])
    })
  })

  describe("Test 6: String value exactly 'provider' before real key", () => {
    it("must NOT match wrong location", () => {
      // given
      const content = `{
  "note": "provider",
  "provider": { "openai": {} },
  "other": 1
}`
      const newProviderValue = { google: { name: "Google" } }

      // when
      const result = modifyProviderInJsonc(content, newProviderValue)

      // then
      expect(result).toContain('"other"')
      expect(result).toContain('"note": "provider"')

      // Post-write validation
      const parsed = parseJsonc<Record<string, unknown>>(result)
      expect(parsed).toHaveProperty('other')
      expect(parsed.other).toBe(1)
      expect(parsed.note).toBe('provider')
    })
  })

  describe("Test 7: Post-write validation", () => {
    it("result file must be valid JSONC for all cases", () => {
      // Test Case 1
      const content1 = `{
  "provider": { "openai": {} },
  "plugin": ["foo"]
}`
      const result1 = modifyProviderInJsonc(content1, { google: {} })
      expect(() => parseJsonc(result1)).not.toThrow()

      // Test Case 2
      const content2 = `{
  "provider": {
    // } comment
    "openai": {}
  }
}`
      const result2 = modifyProviderInJsonc(content2, { google: {} })
      expect(() => parseJsonc(result2)).not.toThrow()

      // Test Case 3
      const content3 = `{
  "plugin": ["foo"]
}`
      const result3 = modifyProviderInJsonc(content3, { google: {} })
      expect(() => parseJsonc(result3)).not.toThrow()
    })
  })

  describe("Test 8: Trailing commas preserved", () => {
    it("file is valid JSONC with trailing commas", () => {
      // given
      const content = `{
  "provider": { "openai": {}, },
  "plugin": ["foo",],
}`
      const newProviderValue = { google: { name: "Google" } }

      // when
      const result = modifyProviderInJsonc(content, newProviderValue)

      // then
      expect(() => parseJsonc(result)).not.toThrow()

      const parsed = parseJsonc<Record<string, unknown>>(result)
      expect(parsed).toHaveProperty('plugin')
      expect(parsed.plugin).toEqual(['foo'])
    })
  })
})

function createInstallConfig(overrides: Partial<InstallConfig> = {}): InstallConfig {
  return {
    hasClaude: false,
    isMax20: false,
    hasOpenAI: false,
    hasGemini: false,
    hasCopilot: false,
    hasOpencodeZen: false,
    hasZaiCodingPlan: false,
    hasKimiForCoding: false,
    hasLmstudio: false,
    hasOllama: false,
    hasVllm: false,
    localProviderModels: createEmptyLocalProviderModels(),
    ...overrides,
  }
}

describe("addProviderConfig local provider support", () => {
  let configDir = ""
  let originalConfigDir: string | undefined

  beforeEach(() => {
    configDir = join(tmpdir(), `omo-provider-config-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(configDir, { recursive: true })
    originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    process.env.OPENCODE_CONFIG_DIR = configDir
    resetConfigContext()
  })

  afterEach(() => {
    resetConfigContext()
    if (originalConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalConfigDir
    }
    rmSync(configDir, { recursive: true, force: true })
  })

  it("generates LMStudio local provider config with discovered models", () => {
    //#given
    const configPath = join(configDir, "opencode.jsonc")
    writeFileSync(configPath, `{\n  \"plugin\": [\"oh-my-opencode\"]\n}\n`)

    const installConfig = createInstallConfig({
      hasLmstudio: true,
      lmstudioUrl: "http://192.168.1.254:1234/v1",
      localProviderModels: {
        lmstudio: [
          {
            id: "devstral-small",
            name: "Devstral Small",
            contextLength: 32768,
            outputLength: 4096,
            capabilities: ["multimodal", "coding", "general"],
            targets: ["explore", "librarian", "atlas", "multimodal-looker", "quick", "unspecified-low"],
          },
        ],
        ollama: [],
        vllm: [],
      },
    })

    //#when
    const result = addProviderConfig(installConfig)

    //#then
    expect(result.success).toBe(true)

    const parsed = parseJsonc<Record<string, unknown>>(readFileSync(configPath, "utf-8"))
    const provider = parsed.provider as Record<string, any>
    expect(provider.lmstudio.type).toBe("openai")
    expect(provider.lmstudio.url).toBe("http://192.168.1.254:1234/v1")
    expect(provider.lmstudio.name).toBe("LMStudio Local")
    expect(provider.lmstudio.models["devstral-small"].name).toBe("Devstral Small")
    expect(provider.lmstudio.models["devstral-small"].limit.context).toBe(32768)
    expect(provider.lmstudio.models["devstral-small"].limit.output).toBe(4096)
  })

  it("writes local provider config alongside existing providers", () => {
    //#given
    const configPath = join(configDir, "opencode.jsonc")
    writeFileSync(
      configPath,
      `{\n  \"provider\": {\n    \"openai\": { \"type\": \"openai\", \"url\": \"https://api.openai.com/v1\" }\n  }\n}\n`
    )

    const installConfig = createInstallConfig({
      hasOllama: true,
      ollamaUrl: "http://localhost:11434",
      localProviderModels: {
        lmstudio: [],
        ollama: [
          {
            id: "qwen3-coder:32b",
            name: "Qwen3 Coder",
            contextLength: 65536,
            outputLength: 8192,
            capabilities: ["coding", "general"],
            targets: ["explore", "librarian", "atlas", "quick", "unspecified-low"],
          },
        ],
        vllm: [],
      },
    })

    //#when
    const result = addProviderConfig(installConfig)

    //#then
    expect(result.success).toBe(true)

    const parsed = parseJsonc<Record<string, unknown>>(readFileSync(configPath, "utf-8"))
    const provider = parsed.provider as Record<string, any>
    expect(provider.openai).toBeTruthy()
    expect(provider.ollama.type).toBe("ollama")
    expect(provider.ollama.url).toBe("http://localhost:11434")
    expect(provider.ollama.models["qwen3-coder:32b"]).toBeTruthy()
  })

  it("does not add local provider config when local flags are omitted", () => {
    //#given
    const configPath = join(configDir, "opencode.jsonc")
    writeFileSync(configPath, `{\n  \"provider\": {}\n}\n`)

    const installConfig = createInstallConfig({
      hasGemini: true,
    })

    //#when
    const result = addProviderConfig(installConfig)

    //#then
    expect(result.success).toBe(true)

    const parsed = parseJsonc<Record<string, unknown>>(readFileSync(configPath, "utf-8"))
    const provider = parsed.provider as Record<string, any>
    expect(provider.google).toBeTruthy()
    expect(provider.lmstudio).toBeUndefined()
    expect(provider.ollama).toBeUndefined()
    expect(provider.vllm).toBeUndefined()
  })
})
