import { cp, mkdir, readFile, readdir, rename, rm } from "node:fs/promises"
import { basename, dirname, join, sep } from "node:path"
import { copyBundledMcpRuntimeDists } from "./codex-cache-bundled-mcps"
import { removeCachedManagedNpmBinShims } from "./codex-cache-bins"
import { fileExistsStrict, isPlainRecord } from "./codex-cache-fs"
import { rewriteCachedPackageLocalFileDependencies } from "./codex-cache-local-dependencies"
import { rewriteCachedManifestRoot, rewriteCachedMcpManifest } from "./codex-cache-mcp-manifest"
import { assertHookCommandTargets } from "./codex-hook-targets"
import type { InstalledPlugin, RunCommand } from "./types"

type RenameDirectory = (fromPath: string, toPath: string) => Promise<void>

export async function installCachedPlugin(input: {
  readonly buildSource?: boolean
  readonly codexHome: string
  readonly env?: NodeJS.ProcessEnv
  readonly marketplaceName: string
  readonly name: string
  readonly renameDirectory?: RenameDirectory
  readonly sourcePath: string
  readonly version: string
  readonly runCommand: RunCommand
}): Promise<InstalledPlugin> {
  const env = input.env ?? process.env
  const npmInstallEnv = sanitizeNpmInstallEnv(env)
  if (input.buildSource !== false) {
    await maybeRunNpmInstall(input.sourcePath, input.runCommand, npmInstallEnv)
    await maybeRunNpmBuild(input.sourcePath, input.runCommand, env)
  }

  const targetPath = join(input.codexHome, "plugins", "cache", input.marketplaceName, input.name, input.version)
  const tempPath = createTempSiblingPath(targetPath)
  await rm(tempPath, { recursive: true, force: true })
  try {
    await copyDirectory(input.sourcePath, tempPath)
    const rewroteLocalFileDependencies = await rewriteCachedPackageLocalFileDependencies(tempPath, input.sourcePath)
    await copyBundledMcpRuntimeDists({ pluginRoot: tempPath, sourceRoot: input.sourcePath })
    await copyRootRuntimeDists({ pluginRoot: tempPath, sourcePath: input.sourcePath })
    // Rewriting local file: dependencies desyncs package.json from package-lock.json, and npm ci
    // aborts with EUSAGE on that drift (lazycodex#137; approach credited to the community fix in
    // oh-my-openagent#6202). The temp cache dir is throwaway, so let npm install reconcile the lock
    // when the rewrite changed package.json; keep the deterministic npm ci fast path otherwise.
    const installArgs = rewroteLocalFileDependencies
      ? ["install", "--omit=dev", "--no-audit", "--no-fund"]
      : ["ci", "--omit=dev"]
    await maybeRunNpmInstall(tempPath, input.runCommand, npmInstallEnv, installArgs)
    await removeCachedManagedNpmBinShims(tempPath)
    if (input.buildSource === false) await maybeRunNpmSyncSkills(tempPath, input.runCommand, env)
    await assertNoRemovedSparkshellPromptReferences(tempPath)
    await rewriteCachedMcpManifest(tempPath, input.sourcePath)
    await rewriteCachedManifestRoot(tempPath, tempPath, targetPath)
    await assertHookCommandTargets(tempPath)
    await promoteDirectory(tempPath, targetPath, input.renameDirectory ?? rename)
  } catch (error) {
    await rm(tempPath, { recursive: true, force: true })
    throw error
  }
  return { name: input.name, version: input.version, path: targetPath }
}

async function maybeRunNpmInstall(
  cwd: string,
  runCommand: RunCommand,
  env: NodeJS.ProcessEnv,
  args: readonly string[] = ["install"],
): Promise<void> {
  if (!(await fileExistsStrict(join(cwd, "package.json")))) return
  await runCommand("npm", args, { cwd, env })
}

async function maybeRunNpmBuild(cwd: string, runCommand: RunCommand, env: NodeJS.ProcessEnv): Promise<void> {
  if (!(await fileExistsStrict(join(cwd, "package.json")))) return
  const packageJson: unknown = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"))
  if (!isPlainRecord(packageJson)) return
  const scripts = packageJson.scripts
  if (!isPlainRecord(scripts) || typeof scripts.build !== "string") return
  await runCommand("npm", ["run", "build"], { cwd, env })
}

async function maybeRunNpmSyncSkills(cwd: string, runCommand: RunCommand, env: NodeJS.ProcessEnv): Promise<void> {
  if (!(await fileExistsStrict(join(cwd, "package.json")))) return
  const packageJson: unknown = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"))
  if (!isPlainRecord(packageJson)) return
  const scripts = packageJson.scripts
  if (!isPlainRecord(scripts) || typeof scripts["sync:skills"] !== "string") return
  await runCommand("npm", ["run", "sync:skills"], { cwd, env })
}

function sanitizeNpmInstallEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"))
}

function createTempSiblingPath(targetPath: string): string {
  return join(dirname(targetPath), `.tmp-${basename(targetPath)}-${process.pid}-${Date.now()}`)
}

function createBackupSiblingPath(targetPath: string): string {
  return join(dirname(targetPath), `.backup-${basename(targetPath)}-${process.pid}-${Date.now()}`)
}

async function copyDirectory(sourcePath: string, targetPath: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true })
  await cp(sourcePath, targetPath, { recursive: true, filter: (source) => shouldCopyPluginPath(source, sourcePath) })
}

async function promoteDirectory(tempPath: string, targetPath: string, renameDirectory: RenameDirectory): Promise<void> {
  const backupPath = createBackupSiblingPath(targetPath)
  await rm(backupPath, { recursive: true, force: true })
  let backupMoved = false
  try {
    if (await fileExistsStrict(targetPath)) {
      await renameDirectory(targetPath, backupPath)
      backupMoved = true
    }
    await renameDirectory(tempPath, targetPath)
  } catch (error) {
    if (backupMoved) await restoreBackupDirectory(backupPath, targetPath, renameDirectory)
    throw error
  }
  if (backupMoved) await rm(backupPath, { recursive: true, force: true })
}

async function restoreBackupDirectory(backupPath: string, targetPath: string, renameDirectory: RenameDirectory): Promise<void> {
  if (!(await fileExistsStrict(backupPath))) return
  await rm(targetPath, { recursive: true, force: true })
  await renameDirectory(backupPath, targetPath)
}

function shouldCopyPluginPath(path: string, root: string): boolean {
  const relative = path === root ? "" : path.slice(root.length + sep.length)
  if (relative === "") return true
  const parts = relative.split(sep)
  if (parts.some((part) => part === ".git" || part === "node_modules")) return false
  return !isNestedComponentMcpManifest(parts)
}

// Codex loads MCP servers only from the plugin-root .mcp.json (.codex-plugin/plugin.json declares
// "mcpServers": "./.mcp.json"). A component's own nested .mcp.json is a standalone-plugin dev
// manifest whose relative daemon path (e.g. ../../../../lsp-daemon/dist/cli.js) resolves in the repo
// layout but dangles in the flattened cache layout, so it must never be copied into the cache.
function isNestedComponentMcpManifest(parts: readonly string[]): boolean {
  return parts.length > 1 && parts.at(-1) === ".mcp.json"
}

const removedSparkshellReferencePattern = /\b(?:sparkshell|spark[-_\s]+shell)\b/i
const removedSparkshellPromptSurfaceDirs = new Set([".codex-plugin", "agents", "bundled-rules", "hooks", "skills"])
const removedSparkshellPromptSurfaceFiles = new Set(["directive.md", "plugin.json"])
const removedSparkshellTextFilePattern = /\.(?:json|md|toml|ya?ml)$/i

async function assertNoRemovedSparkshellPromptReferences(pluginRoot: string): Promise<void> {
  for (const filePath of await listRemovedSparkshellPromptSurfaceFiles(pluginRoot, "")) {
    const content = await readFile(join(pluginRoot, filePath), "utf8")
    if (!removedSparkshellReferencePattern.test(content)) continue
    throw new Error(`removed sparkshell reference found in Codex plugin prompt surface: ${filePath}`)
  }
}

async function listRemovedSparkshellPromptSurfaceFiles(pluginRoot: string, relativeDirectory: string): Promise<readonly string[]> {
  const directory = relativeDirectory === "" ? pluginRoot : join(pluginRoot, relativeDirectory)
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const relativePath = relativeDirectory === "" ? entry.name : join(relativeDirectory, entry.name)
    if (entry.isDirectory()) {
      if (shouldDescendIntoRemovedSparkshellPromptSurface(relativePath)) {
        files.push(...(await listRemovedSparkshellPromptSurfaceFiles(pluginRoot, relativePath)))
      }
      continue
    }
    if (shouldCheckRemovedSparkshellPromptFile(relativePath)) files.push(relativePath)
  }
  return files.sort()
}

function shouldDescendIntoRemovedSparkshellPromptSurface(relativePath: string): boolean {
  const parts = relativePath.split(sep)
  if (parts.some((part) => part === ".git" || part === "dist" || part === "node_modules")) return false
  if (parts[0] === "components") {
    if (parts.length <= 2) return true
    return removedSparkshellPromptSurfaceDirs.has(parts[2])
  }
  return removedSparkshellPromptSurfaceDirs.has(parts[0])
}

function shouldCheckRemovedSparkshellPromptFile(relativePath: string): boolean {
  if (!removedSparkshellTextFilePattern.test(relativePath)) return false
  const parts = relativePath.split(sep)
  const fileName = parts.at(-1) ?? ""
  if (parts[0] === "components") {
    if (parts.length === 3) return removedSparkshellPromptSurfaceFiles.has(fileName)
    return parts.length > 3 && removedSparkshellPromptSurfaceDirs.has(parts[2])
  }
  return removedSparkshellPromptSurfaceDirs.has(parts[0])
}

async function copyRootRuntimeDists(input: { readonly pluginRoot: string; readonly sourcePath: string }): Promise<void> {
  const repoRoot = repoRootForCodexPluginSource(input.sourcePath)
  if (repoRoot === null) return
  for (const runtimePath of ["dist/cli", "dist/cli-node"] as const) {
    const sourcePath = join(repoRoot, runtimePath)
    if (!(await fileExistsStrict(join(sourcePath, "index.js")))) continue
    await mkdir(dirname(join(input.pluginRoot, runtimePath)), { recursive: true })
    await cp(sourcePath, join(input.pluginRoot, runtimePath), { recursive: true })
  }
}

function repoRootForCodexPluginSource(sourcePath: string): string | null {
  const codexPackageRoot = dirname(sourcePath)
  const packagesRoot = dirname(codexPackageRoot)
  if (basename(sourcePath) !== "plugin") return null
  if (basename(codexPackageRoot) !== "omo-codex") return null
  if (basename(packagesRoot) !== "packages") return null
  return dirname(packagesRoot)
}
