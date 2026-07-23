import { isPlainRecord } from "@oh-my-opencode/utils"
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"
import { validateLazycodexPluginBundle } from "./lazycodex-marketplace-validation"
import { copyLazycodexRuntimeDists } from "./lazycodex-runtime-dists"

const MARKETPLACE_SOURCE_PATH = join("packages", "omo-codex", "marketplace.json")
const PLUGIN_SOURCE_PATH = join("packages", "omo-codex", "plugin")
const LAZYCODEX_REPOSITORY_OVERLAY_SOURCE_PATH = join("packages", "omo-codex", "lazycodex-repository")
const MARKETPLACE_DESTINATION_PATH = join(".agents", "plugins", "marketplace.json")
const MARKETPLACE_ROOT_DESTINATION_PATH = "marketplace.json"
const PLUGIN_DESTINATION_PATH = join("plugins", "omo")
const GIT_BASH_MCP_SOURCE_ARG = "../../git-bash-mcp/dist/cli.js"
const GIT_BASH_MCP_PLUGIN_ARG = "./components/git-bash-mcp/dist/cli.js"
const LSP_TOOLS_MCP_SOURCE_ARG = "../../lsp-tools-mcp/dist/cli.js"
const LSP_TOOLS_MCP_PLUGIN_ARG = "./components/lsp-tools-mcp/dist/cli.js"
const LSP_DAEMON_SOURCE_ARG = "../../lsp-daemon/dist/cli.js"
const LSP_DAEMON_PLUGIN_ARG = "./components/lsp-daemon/dist/cli.js"

const MCP_ARG_REWRITES = [
  [GIT_BASH_MCP_SOURCE_ARG, GIT_BASH_MCP_PLUGIN_ARG],
  [LSP_TOOLS_MCP_SOURCE_ARG, LSP_TOOLS_MCP_PLUGIN_ARG],
  [LSP_DAEMON_SOURCE_ARG, LSP_DAEMON_PLUGIN_ARG],
] as const

export interface SyncLazycodexMarketplaceInput {
  readonly sourceRoot: string
  readonly lazycodexRoot: string
  readonly releaseVersion?: string
  readonly allowMissingBundledDists?: boolean
}

interface MarketplaceManifest {
  readonly name: string
}

interface PluginManifest {
  readonly name: string
  readonly version?: string
}

export async function syncLazycodexMarketplace(input: SyncLazycodexMarketplaceInput): Promise<void> {
  const sourceRoot = resolve(input.sourceRoot)
  const lazycodexRoot = resolve(input.lazycodexRoot)
  const marketplacePath = join(sourceRoot, MARKETPLACE_SOURCE_PATH)
  const pluginRoot = join(sourceRoot, PLUGIN_SOURCE_PATH)
  const pluginManifestPath = join(pluginRoot, ".codex-plugin", "plugin.json")

  const marketplace = await readMarketplaceManifest(marketplacePath)
  if (marketplace.name !== "sisyphuslabs") {
    throw new Error(`Sisyphus Labs marketplace manifest must be named sisyphuslabs, got ${marketplace.name}`)
  }

  const pluginManifest = await readPluginManifest(pluginManifestPath)
  if (pluginManifest.name !== "omo") {
    throw new Error(`Sisyphus Labs plugin manifest must be named omo, got ${pluginManifest.name}`)
  }

  const marketplaceContents = await readFile(marketplacePath, "utf8")
  const destinationMarketplacePath = join(lazycodexRoot, MARKETPLACE_DESTINATION_PATH)
  await mkdir(dirname(destinationMarketplacePath), { recursive: true })
  await writeFile(destinationMarketplacePath, marketplaceContents)
  // `codex plugin marketplace add <repo>` scans the repository ROOT for a
  // supported manifest, so publish marketplace.json at the root as well (the
  // .agents/plugins copy stays for back-compat). Its "source": "./plugins/omo"
  // resolves correctly from the root, where the plugin payload is copied.
  await writeFile(join(lazycodexRoot, MARKETPLACE_ROOT_DESTINATION_PATH), marketplaceContents)

  const destinationPluginRoot = join(lazycodexRoot, PLUGIN_DESTINATION_PATH)
  await rm(destinationPluginRoot, { recursive: true, force: true })
  await mkdir(dirname(destinationPluginRoot), { recursive: true })
  await cp(pluginRoot, destinationPluginRoot, {
    recursive: true,
    filter: (path) => shouldCopyPluginPath(path, pluginRoot),
  })
  await copyLazycodexRepositoryOverlay(sourceRoot, lazycodexRoot)
  await copyLazycodexRuntimeDists({
    sourceRoot,
    lazycodexRoot,
    skipMissing: input.allowMissingBundledDists === true,
  })
  await rewritePluginMcpManifest(destinationPluginRoot)
  await stampReleaseVersion(destinationPluginRoot, input.releaseVersion ?? process.env.LAZYCODEX_RELEASE_VERSION)
  await validateLazycodexPluginBundle(destinationPluginRoot, {
    requireRootCliRuntime: input.allowMissingBundledDists !== true,
  })
}

async function readMarketplaceManifest(path: string): Promise<MarketplaceManifest> {
  const parsed = JSON.parse(await readFile(path, "utf8"))
  if (isPlainRecord(parsed) && typeof parsed.name === "string") {
    return { name: parsed.name }
  }
  throw new Error("invalid Sisyphus Labs marketplace manifest")
}

async function readPluginManifest(path: string): Promise<PluginManifest> {
  if (!(await isFile(path))) {
    throw new Error(`missing Codex plugin manifest at ${path}`)
  }
  const parsed = JSON.parse(await readFile(path, "utf8"))
  if (isPlainRecord(parsed) && typeof parsed.name === "string") {
    return {
      name: parsed.name,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
    }
  }
  throw new Error("invalid Codex plugin manifest")
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (error instanceof Error) return false
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if (error instanceof Error) return false
    return false
  }
}

async function copyLazycodexRepositoryOverlay(sourceRoot: string, lazycodexRoot: string): Promise<void> {
  const sourcePath = join(sourceRoot, LAZYCODEX_REPOSITORY_OVERLAY_SOURCE_PATH)
  if (!(await isDirectory(sourcePath))) return
  await cp(sourcePath, lazycodexRoot, {
    recursive: true,
    filter: (path) => shouldCopyLazycodexRepositoryOverlayPath(path, sourcePath),
  })
}

async function rewritePluginMcpManifest(pluginRoot: string): Promise<void> {
  const manifestPath = join(pluginRoot, ".mcp.json")
  if (!(await isFile(manifestPath))) return
  const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"))
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.mcpServers)) return

  let changed = false
  for (const server of Object.values(parsed.mcpServers)) {
    if (!isPlainRecord(server) || !Array.isArray(server.args)) continue
    const currentArgs = server.args
    const nextArgs = currentArgs.map(rewriteMcpArg)
    if (nextArgs.some((arg, index) => arg !== currentArgs[index])) {
      server.args = nextArgs
      changed = true
    }
  }
  if (changed) await writeFile(manifestPath, `${JSON.stringify(parsed, null, "\t")}\n`)
}

async function stampReleaseVersion(pluginRoot: string, releaseVersion: string | undefined): Promise<void> {
  const version = releaseVersion?.trim()
  if (version === undefined || version.length === 0) return
  await stampJsonVersion(join(pluginRoot, ".codex-plugin", "plugin.json"), version)
  await stampJsonVersion(join(pluginRoot, "package.json"), version)
  for (const hooksPath of await collectHookManifestPaths(pluginRoot)) {
    await stampHookStatusMessages(hooksPath, version)
  }
}

async function collectHookManifestPaths(root: string): Promise<string[]> {
  const paths: string[] = []
  await collectHookManifestPathsInto(root, paths)
  return paths
}

async function collectHookManifestPathsInto(root: string, paths: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error instanceof Error) return
    return
  }
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") continue
      await collectHookManifestPathsInto(path, paths)
      continue
    }
    if (entry.isFile() && entry.name === "hooks.json" && path.endsWith(`${sep}hooks${sep}hooks.json`)) {
      paths.push(path)
    }
  }
}

async function stampJsonVersion(path: string, version: string): Promise<void> {
  if (!(await isFile(path))) return
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
  if (!isPlainRecord(parsed)) return
  parsed.version = version
  await writeFile(path, `${JSON.stringify(parsed, null, "\t")}\n`)
}

async function stampHookStatusMessages(path: string, version: string): Promise<void> {
  if (!(await isFile(path))) return
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.hooks)) return
  for (const groups of Object.values(parsed.hooks)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      if (!isPlainRecord(group) || !Array.isArray(group.hooks)) continue
      for (const hook of group.hooks) {
        stampHookStatusMessage(hook, version)
      }
    }
  }
  await writeFile(path, `${JSON.stringify(parsed, null, "\t")}\n`)
}

function stampHookStatusMessage(hook: unknown, version: string): void {
  if (!isPlainRecord(hook) || typeof hook.statusMessage !== "string") return
  hook.statusMessage = hook.statusMessage.replace(/^LazyCodex\([^)]+\):/, `LazyCodex(${version}):`)
}

function rewriteMcpArg(arg: unknown): unknown {
  if (typeof arg !== "string") return arg
  const rewrite = MCP_ARG_REWRITES.find(([sourceArg]) => sourceArg === arg)
  return rewrite?.[1] ?? arg
}

const PLUGIN_COPY_DENYLIST = new Set([".git", "node_modules", ".ulw", ".claude"])
const LAZYCODEX_REPOSITORY_OVERLAY_COPY_DENYLIST = new Set([
  ".git",
  "node_modules",
  ".next",
  ".open-next",
  ".wrangler",
])

function shouldCopyPluginPath(path: string, root: string): boolean {
  const relative = path === root ? "" : path.slice(root.length + sep.length)
  if (relative.length === 0) return true
  const parts = relative.split(sep)
  if (parts.some((part) => PLUGIN_COPY_DENYLIST.has(part))) return false
  if (parts.length <= 1) return true
  const name = parts.at(-1)
  // Codex loads MCP servers only from the plugin-root .mcp.json (.codex-plugin/plugin.json declares
  // "mcpServers": "./.mcp.json"). A component's own nested .mcp.json is a standalone-plugin dev
  // manifest whose relative daemon path dangles once the plugin is flattened into the bundle, so it
  // must never ship in plugins/omo.
  if (name === ".mcp.json") return false
  // A component's nested .gitignore is a standalone-repository dev artifact. When it ships in the
  // marketplace payload, a `dist/` rule in it overrides the lazycodex repository's root negation
  // (`!plugins/omo/components/*/dist/**`), so `git add plugins/omo` silently drops the component's
  // built CLI from the repo even though the file was copied and validated on disk. That is how
  // start-work-continuation/dist/cli.js and ulw-loop/dist/cli.js went missing while rules and
  // ultrawork (whose nested .gitignore has no `dist/` rule) survived (lazycodex#108).
  return name !== ".gitignore"
}

function shouldCopyLazycodexRepositoryOverlayPath(path: string, root: string): boolean {
  const relative = path === root ? "" : path.slice(root.length + sep.length)
  if (relative.length === 0) return true
  return !relative.split(sep).some((part) => LAZYCODEX_REPOSITORY_OVERLAY_COPY_DENYLIST.has(part))
}



if (import.meta.main) {
  const args = process.argv.slice(2)
  const positional = args.filter((a) => !a.startsWith("--"))
  const sourceRoot = positional[0] ?? process.cwd()
  const lazycodexRoot = positional[1]
  if (lazycodexRoot === undefined) {
    throw new Error("Usage: bun run script/sync-lazycodex-marketplace.ts <source-root> <lazycodex-root>")
  }
  await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot, allowMissingBundledDists: args.includes("--previous-payload") })
}
