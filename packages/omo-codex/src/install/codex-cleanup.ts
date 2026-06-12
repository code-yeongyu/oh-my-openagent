import { isPlainRecord } from "./codex-cache-fs"
import { lstat, readFile, readdir, rm, rmdir } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join, relative, resolve } from "node:path"
import { cleanupCodexConfig, MANAGED_CODEX_AGENT_NAMES } from "./codex-cleanup-config"
import { repairProjectLocalCodexArtifactsBestEffort } from "./codex-project-local-cleanup-best-effort"
import type { ProjectLocalCodexCleanupResult } from "./codex-project-local-cleanup"

const INSTALLED_AGENTS_MANIFEST = ".installed-agents.json"

export interface CodexCleanupOptions {
  readonly codexHome?: string
  readonly projectDirectory?: string
  readonly env?: { readonly [key: string]: string | undefined }
  readonly now?: () => Date
}

export interface CodexCleanupResult {
  readonly codexHome: string
  readonly configPath: string
  readonly configChanged: boolean
  readonly configBackupPath?: string
  readonly removedPaths: readonly string[]
  readonly removedAgentLinks: readonly string[]
  readonly skippedAgentLinks: readonly string[]
  readonly projectCleanup: ProjectLocalCodexCleanupResult
}

export async function cleanupCodexLight(input: CodexCleanupOptions = {}): Promise<CodexCleanupResult> {
  const env = input.env ?? process.env
  const codexHome = resolve(input.codexHome ?? env.CODEX_HOME ?? join(homedir(), ".codex"))
  const configPath = join(codexHome, "config.toml")

  const agentPaths = await collectInstalledAgentPaths(codexHome, configPath)
  const configCleanup = await cleanupCodexConfig(configPath, input.now)
  const agentCleanup = await removeManifestListedAgentLinks(codexHome, agentPaths)

  const removedPaths: string[] = []
  const managedStatePaths = new Set([
    ...managedGlobalStatePaths(codexHome),
    ...(await collectBootstrapDataDirsByGlob(codexHome)),
  ])
  for (const path of managedStatePaths) {
    if (await removeManagedPathBestEffort(path)) removedPaths.push(path)
  }
  await pruneEmptyRuntimeDirBestEffort(codexHome)

  const projectDirectory = input.projectDirectory ?? env.OMO_CODEX_PROJECT ?? process.cwd()
  const projectCleanup = await repairProjectLocalCodexArtifactsBestEffort({
    startDirectory: projectDirectory,
    codexHome,
    now: input.now,
    log: () => undefined,
  })

  return {
    codexHome,
    configPath,
    configChanged: configCleanup.changed,
    configBackupPath: configCleanup.backupPath,
    removedPaths,
    removedAgentLinks: agentCleanup.removed,
    skippedAgentLinks: agentCleanup.skipped,
    projectCleanup,
  }
}

export { cleanupCodexLightConfigText } from "./codex-cleanup-config"

function managedGlobalStatePaths(codexHome: string): readonly string[] {
  return [
    join(codexHome, "plugins", "cache", "sisyphuslabs"),
    join(codexHome, ".tmp", "marketplaces", "sisyphuslabs"),
    // Deletion-safety invariant: runtime/ast-grep and runtime/node are the
    // only managed runtime subtrees - never remove `runtime/` wholesale.
    join(codexHome, "runtime", "ast-grep"),
    join(codexHome, "runtime", "node"),
    // codex core-plugins store convention: plugins/data/<plugin>-<marketplace>/
    join(codexHome, "plugins", "data", "omo-sisyphuslabs", "bootstrap"),
  ]
}

const BOOTSTRAP_DATA_GLOB_MAX_DEPTH = 5

// Defensive fallback for plugin-data layout drift, mirroring the glob
// `<codexHome>/plugins/**/omo*sisyphuslabs*/bootstrap`; symlinks are never
// followed and non-matching (non-omo) plugin data is never touched.
async function collectBootstrapDataDirsByGlob(codexHome: string): Promise<readonly string[]> {
  const results: string[] = []
  await walkForManagedBootstrapDirs(join(codexHome, "plugins"), 0, results)
  return results
}

async function walkForManagedBootstrapDirs(directory: string, depth: number, results: string[]): Promise<void> {
  if (depth > BOOTSTRAP_DATA_GLOB_MAX_DEPTH) return
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => null)
  if (entries === null) return
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const childPath = join(directory, entry.name)
    if (isManagedBootstrapOwnerName(entry.name)) {
      const bootstrapDir = join(childPath, "bootstrap")
      if (await exists(bootstrapDir)) results.push(bootstrapDir)
      continue
    }
    await walkForManagedBootstrapDirs(childPath, depth + 1, results)
  }
}

function isManagedBootstrapOwnerName(name: string): boolean {
  return name.startsWith("omo") && name.slice("omo".length).includes("sisyphuslabs")
}

export interface RemoveManagedPathSeams {
  readonly afterFirstAttempt?: () => Promise<void> | void
}

// Removal is best-effort with a single retry: a mid-flight bootstrap worker
// may recreate state between the first removal and the re-check. If the
// artifact reappears after the retry as well, the cleanup still exits 0 and a
// second `lazycodex-ai uninstall` run clears it.
export async function removeManagedPathBestEffort(
  path: string,
  seams: RemoveManagedPathSeams = {},
): Promise<boolean> {
  const removedOnFirstAttempt = await attemptRemove(path)
  await seams.afterFirstAttempt?.()
  const removedOnRetry = await attemptRemove(path)
  return removedOnFirstAttempt || removedOnRetry
}

async function attemptRemove(path: string): Promise<boolean> {
  try {
    if ((await lstat(path).catch(() => null)) === null) return false
    await rm(path, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

// Drops `<codexHome>/runtime` only when removing the managed subtrees left it
// empty: rmdir is non-recursive, so a runtime dir holding any other owner's
// content stays untouched.
async function pruneEmptyRuntimeDirBestEffort(codexHome: string): Promise<void> {
  try {
    await rmdir(join(codexHome, "runtime"))
  } catch {
    // best-effort: missing, non-empty, or locked runtime dirs are left as-is
  }
}

async function collectInstalledAgentPaths(codexHome: string, configPath: string): Promise<readonly string[]> {
  const manifestPaths: string[] = [
    join(codexHome, ".tmp", "marketplaces", "sisyphuslabs", "plugins", "omo", INSTALLED_AGENTS_MANIFEST),
  ]
  const versionRoot = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo")
  if (await exists(versionRoot)) {
    const entries = await readdir(versionRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) manifestPaths.push(join(versionRoot, entry.name, INSTALLED_AGENTS_MANIFEST))
    }
  }

  const paths = new Set<string>()
  for (const path of await readManagedAgentPathsFromConfig(codexHome, configPath)) {
    paths.add(path)
  }
  for (const manifestPath of manifestPaths) {
    for (const path of await readInstalledAgentManifest(manifestPath)) {
      paths.add(path)
    }
  }
  return [...paths].sort()
}

async function readManagedAgentPathsFromConfig(codexHome: string, configPath: string): Promise<readonly string[]> {
  if (!(await exists(configPath))) return []
  const config = await readFile(configPath, "utf8")
  return MANAGED_CODEX_AGENT_NAMES
    .filter((agentName) => config.includes(`config_file = ${JSON.stringify(`./agents/${agentName}.toml`)}`))
    .map((agentName) => join(codexHome, "agents", `${agentName}.toml`))
}

async function readInstalledAgentManifest(manifestPath: string): Promise<readonly string[]> {
  if (!(await exists(manifestPath))) return []
  const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"))
  if (!isPlainRecord(parsed) || !Array.isArray(parsed.agents)) return []
  return parsed.agents.filter((path): path is string => typeof path === "string")
}

async function removeManifestListedAgentLinks(
  codexHome: string,
  paths: readonly string[],
): Promise<{ readonly removed: readonly string[]; readonly skipped: readonly string[] }> {
  const agentsDir = join(codexHome, "agents")
  const removed: string[] = []
  const skipped: string[] = []

  for (const path of paths) {
    if (!isSafeManagedAgentPath(agentsDir, path)) {
      skipped.push(path)
      continue
    }

    const entryStat = await maybeLstat(path)
    if (entryStat === null) continue
    if (entryStat.isDirectory() && !entryStat.isSymbolicLink()) {
      skipped.push(path)
      continue
    }

    await rm(path, { force: true })
    removed.push(path)
  }

  return { removed, skipped }
}

function isSafeManagedAgentPath(agentsDir: string, path: string): boolean {
  if (!isAbsolute(path)) return false
  const relativePath = relative(agentsDir, path)
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) return false
  const fileName = relativePath.split(/[\\/]/).pop()
  if (fileName === undefined) return false
  return MANAGED_CODEX_AGENT_NAMES.some((agentName) => fileName === `${agentName}.toml`)
}

async function exists(path: string): Promise<boolean> {
  return (await maybeLstat(path)) !== null
}

async function maybeLstat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path)
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return null
    throw error
  }
}

function nodeErrorCode(error: unknown): string | null {
  if (!(error instanceof Error) || !("code" in error)) return null
  return typeof error.code === "string" ? error.code : null
}
