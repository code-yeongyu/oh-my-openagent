import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse } from "jsonc-parser"
import { addAtlasCloudProviderToOpenCodeConfig } from "./add-atlas-cloud-provider-to-opencode-config"
import { resetConfigContext } from "./config-context"

const originalConfigDir = process.env.OPENCODE_CONFIG_DIR

afterEach(() => {
  resetConfigContext()
  if (originalConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
  else process.env.OPENCODE_CONFIG_DIR = originalConfigDir
})

describe("addAtlasCloudProviderToOpenCodeConfig", () => {
  test("writes an environment-backed OpenAI-compatible provider without a secret", () => {
    const configDir = mkdtempSync(join(tmpdir(), "omo-atlas-provider-"))
    process.env.OPENCODE_CONFIG_DIR = configDir
    resetConfigContext()

    try {
      const result = addAtlasCloudProviderToOpenCodeConfig()
      const content = readFileSync(result.configPath, "utf-8")
      const config = parse(content) as Record<string, Record<string, Record<string, unknown>>>
      const atlas = config.provider?.atlascloud

      expect(result.success).toBe(true)
      expect(atlas?.npm).toBe("@ai-sdk/openai-compatible")
      expect(atlas?.options).toEqual({ baseURL: "https://api.atlascloud.ai/v1", apiKey: "{env:ATLASCLOUD_API_KEY}" })
      expect((atlas?.models as Record<string, unknown>)["moonshotai/kimi-k3"]).toBeDefined()
      expect(content).not.toContain("sk-")
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test("preserves an existing user-owned Atlas Cloud provider byte for byte", () => {
    const configDir = mkdtempSync(join(tmpdir(), "omo-atlas-provider-existing-"))
    const configPath = join(configDir, "opencode.jsonc")
    const original = [
      "// custom endpoint",
      "{",
      '  "provider": {',
      '    "atlascloud": { "npm": "custom", "options": { "baseURL": "https://example.test" } }',
      "  }",
      "}",
      "",
    ].join("\n")
    writeFileSync(configPath, original)
    process.env.OPENCODE_CONFIG_DIR = configDir
    resetConfigContext()

    try {
      expect(addAtlasCloudProviderToOpenCodeConfig().success).toBe(true)
      expect(readFileSync(configPath, "utf-8")).toBe(original)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})
