import { isPlainRecord } from "./codex-cache-fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type {
  MarketplaceManifest,
  MarketplacePluginEntry,
  MarketplacePluginSourceLocal,
  PluginManifest,
} from "./types"

const DEFAULT_MARKETPLACE_PATH = "packages/omo-codex/marketplace.json"

export async function readMarketplace(
  repoRoot: string,
  options?: { readonly marketplacePath?: string },
): Promise<MarketplaceManifest> {
  const marketplacePath = options?.marketplacePath ?? join(repoRoot, DEFAULT_MARKETPLACE_PATH)
  const raw = await readFile(marketplacePath, "utf8")
  const parsed: unknown = JSON.parse(raw)
  if (!isPlainRecord(parsed)) throw new Error("marketplace.json must be an object")
  if (typeof parsed.name !== "string" || parsed.name.trim() === "") {
    throw new Error("marketplace.json name must be a non-empty string")
  }
  validatePathSegment(parsed.name, "marketplace name")
  if (!Array.isArray(parsed.plugins)) throw new Error("marketplace.json plugins must be an array")
  return {
    name: parsed.name,
    plugins: parsed.plugins.map((plugin, index) => normalizeMarketplacePlugin(plugin, index)),
  }
}

export function resolvePluginSource(
  repoRoot: string,
  plugin: MarketplacePluginEntry,
  options?: { readonly pathOverride?: string },
): string {
  const sourcePath = localSourcePath(options?.pathOverride ?? plugin.source)
  const relativePath = sourcePath.slice(2)
  return join(repoRoot, ...relativePath.split(/[\\/]/))
}

export async function readPluginManifest(pluginRoot: string): Promise<PluginManifest> {
  const raw = await readFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8")
  const parsed: unknown = JSON.parse(raw)
  if (!isPlainRecord(parsed)) throw new Error(`${pluginRoot} plugin.json must be an object`)
  if (typeof parsed.name !== "string" || parsed.name.trim() === "") {
    throw new Error(`${pluginRoot} plugin.json name must be a non-empty string`)
  }
  if (parsed.version !== undefined && (typeof parsed.version !== "string" || parsed.version.trim() === "")) {
    throw new Error(`${pluginRoot} plugin.json version must be a non-empty string`)
  }
  if (parsed.hooks !== undefined && (typeof parsed.hooks !== "string" || parsed.hooks.trim() === "")) {
    throw new Error(`${pluginRoot} plugin.json hooks must be a non-empty string`)
  }
  return {
    name: parsed.name,
    version: typeof parsed.version === "string" ? parsed.version.trim() : undefined,
    hooks: typeof parsed.hooks === "string" ? parsed.hooks.trim() : undefined,
  }
}

export function validatePathSegment(value: string, label: string): void {
  if (!/^[A-Za-z0-9._+-]+$/.test(value)) {
    throw new Error(`${label} contains unsupported characters: ${value}`)
  }
  if (value === "." || value === "..") {
    throw new Error(`${label} must not be a path traversal segment`)
  }
}

function normalizeMarketplacePlugin(plugin: unknown, index: number): MarketplacePluginEntry {
  if (!isPlainRecord(plugin)) throw new Error(`marketplace plugin ${index} must be an object`)
  if (typeof plugin.name !== "string" || plugin.name.trim() === "") {
    throw new Error(`marketplace plugin ${index} name must be a non-empty string`)
  }
  validatePathSegment(plugin.name, "plugin name")
  if (plugin.source === undefined || typeof plugin.source === "string") {
    if (typeof plugin.source === "string") {
      validateLocalSourcePath(plugin.source)
    }
    return { name: plugin.name, source: plugin.source }
  }
  if (isPlainRecord(plugin.source) && plugin.source.source === "local" && typeof plugin.source.path === "string") {
    validateLocalSourcePath(plugin.source.path)
    const local: MarketplacePluginSourceLocal = { source: "local", path: plugin.source.path }
    return { name: plugin.name, source: local }
  }
  throw new Error("local plugin source must be a string path or { source: \"local\", path } object")
}

function localSourcePath(source: string | MarketplacePluginSourceLocal | undefined): string {
  if (typeof source === "string") return validateLocalSourcePath(source)
  if (source?.source === "local") return validateLocalSourcePath(source.path)
  throw new Error("local plugin source path is required")
}

function validateLocalSourcePath(path: string): string {
  if (!path.startsWith("./")) throw new Error("local plugin source path must start with ./")
  const relative = path.slice(2)
  if (relative.length === 0) throw new Error("local plugin source path must not be empty")
  for (const part of relative.split(/[\\/]/)) {
    if (part === "" || part === "." || part === "..") {
      throw new Error("local plugin source path must stay within the marketplace root")
    }
  }
  return path
}
