import { describe, expect, test } from "bun:test"
import {
  ATLAS_CLOUD_CODEX_PROVIDER_BLOCK,
  ensureAtlasCloudModelProvider,
  isCanonicalAtlasCloudModelProviderSection,
} from "./codex-config-model-providers"

const omoInstall = { marketplaceName: "sisyphuslabs", pluginNames: ["omo"] }

describe("Atlas Cloud Codex model provider", () => {
  test("registers the Responses provider without changing the selected model", () => {
    const config = ensureAtlasCloudModelProvider('model = "gpt-5.6-sol"\n', omoInstall)

    expect(config).toContain("[model_providers.atlascloud]")
    expect(config).toContain('env_key = "ATLASCLOUD_API_KEY"')
    expect(config).toContain('wire_api = "responses"')
    expect(config).toContain('model = "gpt-5.6-sol"')
    expect(config).not.toContain('model_provider = "atlascloud"')
  })

  test("preserves an existing user-owned provider byte for byte", () => {
    const original = [
      "[model_providers.atlascloud] # custom",
      'base_url = "https://example.test/v1"',
      'env_key = "CUSTOM_ATLAS_KEY"',
      "",
    ].join("\n")

    expect(ensureAtlasCloudModelProvider(original, omoInstall)).toBe(original)
  })

  test("recognizes a quoted provider table as user-owned", () => {
    const original = [
      '[model_providers."atlascloud"]',
      'base_url = "https://quoted.example/v1"',
      'env_key = "QUOTED_ATLAS_KEY"',
      "",
    ].join("\n")

    expect(ensureAtlasCloudModelProvider(original, omoInstall)).toBe(original)
  })

  test("is idempotent and only applies to the canonical OMO marketplace", () => {
    const first = ensureAtlasCloudModelProvider("", omoInstall)
    expect(ensureAtlasCloudModelProvider(first, omoInstall)).toBe(first)
    expect(ensureAtlasCloudModelProvider("", { marketplaceName: "debug", pluginNames: ["omo"] })).toBe("")
    expect(isCanonicalAtlasCloudModelProviderSection(ATLAS_CLOUD_CODEX_PROVIDER_BLOCK)).toBe(true)
  })
})
