import { appendBlock, findTomlSection } from "./toml-section-editor"

export const ATLAS_CLOUD_CODEX_PROVIDER_HEADER = "model_providers.atlascloud"

export const ATLAS_CLOUD_CODEX_PROVIDER_BLOCK = [
  `[${ATLAS_CLOUD_CODEX_PROVIDER_HEADER}]`,
  'name = "Atlas Cloud"',
  'base_url = "https://api.atlascloud.ai/v1"',
  'env_key = "ATLASCLOUD_API_KEY"',
  'wire_api = "responses"',
  "requires_openai_auth = false",
  "",
].join("\n")

export function ensureAtlasCloudModelProvider(
  config: string,
  input: { readonly marketplaceName: string; readonly pluginNames: readonly string[] },
): string {
  if (input.marketplaceName !== "sisyphuslabs" || !input.pluginNames.includes("omo")) return config
  if (findTomlSection(config, ATLAS_CLOUD_CODEX_PROVIDER_HEADER) !== null) return config
  return appendBlock(config, ATLAS_CLOUD_CODEX_PROVIDER_BLOCK)
}

export function isCanonicalAtlasCloudModelProviderSection(sectionText: string): boolean {
  return normalizeTomlSection(sectionText) === normalizeTomlSection(ATLAS_CLOUD_CODEX_PROVIDER_BLOCK)
}

function normalizeTomlSection(sectionText: string): string {
  return sectionText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
}
