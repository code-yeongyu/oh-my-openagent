import { isPlainRecord } from "@oh-my-opencode/utils"
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"
import { validateLazycodexPluginBundle } from "./lazycodex-marketplace-validation"

const MARKETPLACE_SOURCE_PATH = join("packages", "omo-codex", "marketplace.json")
const PLUGIN_SOURCE_PATH = join("packages", "omo-codex", "plugin")
const AST_GREP_MCP_DIST_SOURCE_PATH = join("packages", "ast-grep-mcp", "dist")
const GIT_BASH_MCP_DIST_SOURCE_PATH = join("packages", "git-bash-mcp", "dist")
const LSP_TOOLS_MCP_DIST_SOURCE_PATH = join("packages", "lsp-tools-mcp", "dist")
const LSP_DAEMON_DIST_SOURCE_PATH = join("packages", "lsp-daemon", "dist")
const LAZYCODEX_PR_SOURCE_GUIDANCE_SOURCE_PATH = join(
  "packages",
  "omo-codex",
  "lazycodex-repository",
  ".github",
  "workflows",
  "pr-source-guidance.yml",
)
const MARKETPLACE_DESTINATION_PATH = join(".agents", "plugins", "marketplace.json")
const PLUGIN_DESTINATION_PATH = join("plugins", "omo")
const LAZYCODEX_PR_SOURCE_GUIDANCE_DESTINATION_PATH = join(".github", "workflows", "pr-source-guidance.yml")
const AST_GREP_MCP_DIST_DESTINATION_PATH = join(PLUGIN_DESTINATION_PATH, "components", "ast-grep-mcp", "dist")
const GIT_BASH_MCP_DIST_DESTINATION_PATH = join(PLUGIN_DESTINATION_PATH, "components", "git-bash-mcp", "dist")
const LSP_TOOLS_MCP_DIST_DESTINATION_PATH = join(PLUGIN_DESTINATION_PATH, "components", "lsp-tools-mcp", "dist")
const LSP_DAEMON_DIST_DESTINATION_PATH = join(PLUGIN_DESTINATION_PATH, "components", "lsp-daemon", "dist")
const AST_GREP_MCP_SOURCE_ARG = "../../ast-grep-mcp/dist/cli.js"
const AST_GREP_MCP_PLUGIN_ARG = "./components/ast-grep-mcp/dist/cli.js"
const GIT_BASH_MCP_SOURCE_ARG = "../../git-bash-mcp/dist/cli.js"
const GIT_BASH_MCP_PLUGIN_ARG = "./components/git-bash-mcp/dist/cli.js"
const LSP_TOOLS_MCP_SOURCE_ARG = "../../lsp-tools-mcp/dist/cli.js"
const LSP_TOOLS_MCP_PLUGIN_ARG = "./components/lsp-tools-mcp/dist/cli.js"
const LSP_DAEMON_SOURCE_ARG = "../../lsp-daemon/dist/cli.js"
const LSP_DAEMON_PLUGIN_ARG = "./components/lsp-daemon/dist/cli.js"

const BUNDLED_MCP_DISTS = [
  {
    label: "ast-grep MCP",
    sourcePath: AST_GREP_MCP_DIST_SOURCE_PATH,
    destinationPath: AST_GREP_MCP_DIST_DESTINATION_PATH,
  },
  {
    label: "git-bash MCP",
    sourcePath: GIT_BASH_MCP_DIST_SOURCE_PATH,
    destinationPath: GIT_BASH_MCP_DIST_DESTINATION_PATH,
  },
  {
    label: "LSP MCP",
    sourcePath: LSP_TOOLS_MCP_DIST_SOURCE_PATH,
    destinationPath: LSP_TOOLS_MCP_DIST_DESTINATION_PATH,
  },
  {
    label: "LSP daemon",
    sourcePath: LSP_DAEMON_DIST_SOURCE_PATH,
    destinationPath: LSP_DAEMON_DIST_DESTINATION_PATH,
  },
] as const

const MCP_ARG_REWRITES = [
  [AST_GREP_MCP_SOURCE_ARG, AST_GREP_MCP_PLUGIN_ARG],
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

  const destinationMarketplacePath = join(lazycodexRoot, MARKETPLACE_DESTINATION_PATH)
  await mkdir(dirname(destinationMarketplacePath), { recursive: true })
  await writeFile(destinationMarketplacePath, await readFile(marketplacePath, "utf8"))

  const destinationPluginRoot = join(lazycodexRoot, PLUGIN_DESTINATION_PATH)
  await rm(destinationPluginRoot, { recursive: true, force: true })
  await mkdir(dirname(destinationPluginRoot), { recursive: true })
  await cp(pluginRoot, destinationPluginRoot, {
    recursive: true,
    filter: (path) => shouldCopyPluginPath(path, pluginRoot),
  })
  await copyLazycodexRepositoryWorkflow(sourceRoot, lazycodexRoot)
  await copyBundledMcpDists(sourceRoot, lazycodexRoot, input.allowMissingBundledDists === true)
  await rewritePluginMcpManifest(destinationPluginRoot)
  await stampReleaseVersion(destinationPluginRoot, input.releaseVersion ?? process.env.LAZYCODEX_RELEASE_VERSION)
  await validateLazycodexPluginBundle(destinationPluginRoot)
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

async function copyBundledMcpDists(sourceRoot: string, lazycodexRoot: string, skipMissing: boolean): Promise<void> {
  for (const mcpDist of BUNDLED_MCP_DISTS) {
    await copyBundledMcpDist(sourceRoot, lazycodexRoot, mcpDist, skipMissing)
  }
}

async function copyLazycodexRepositoryWorkflow(sourceRoot: string, lazycodexRoot: string): Promise<void> {
  const sourcePath = join(sourceRoot, LAZYCODEX_PR_SOURCE_GUIDANCE_SOURCE_PATH)
  if (!(await isFile(sourcePath))) return
  const destinationPath = join(lazycodexRoot, LAZYCODEX_PR_SOURCE_GUIDANCE_DESTINATION_PATH)
  await mkdir(dirname(destinationPath), { recursive: true })
  await writeFile(destinationPath, await readFile(sourcePath, "utf8"))
}

async function copyBundledMcpDist(
  sourceRoot: string,
  lazycodexRoot: string,
  mcpDist: (typeof BUNDLED_MCP_DISTS)[number],
  skipMissing: boolean,
): Promise<void> {
  const sourcePath = join(sourceRoot, mcpDist.sourcePath)
  if (!(await isDirectory(sourcePath))) {
    if (skipMissing) {
      console.warn(`[sync-lazycodex-marketplace] previous-payload reconstruction: skipping missing ${mcpDist.label} dist at ${sourcePath}`)
      return
    }
    throw new Error(`missing built ${mcpDist.label} dist at ${sourcePath}`)
  }
  const destinationPath = join(lazycodexRoot, mcpDist.destinationPath)
  await mkdir(dirname(destinationPath), { recursive: true })
  await cp(sourcePath, destinationPath, { recursive: true })
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

function shouldCopyPluginPath(path: string, root: string): boolean {
  const relative = path === root ? "" : path.slice(root.length + sep.length)
  if (relative.length === 0) return true
  return !relative.split(sep).some((part) => PLUGIN_COPY_DENYLIST.has(part))
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
