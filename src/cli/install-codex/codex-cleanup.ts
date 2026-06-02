import { lstat, readFile, readdir, rm } from "node:fs/promises"
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

  const agentPaths = await collectInstalledAgentPaths(codexHome)
  const configCleanup = await cleanupCodexConfig(configPath, input.now)
  const agentCleanup = await removeManifestListedAgentLinks(codexHome, agentPaths)

  const removedPaths: string[] = []
  for (const path of managedGlobalStatePaths(codexHome)) {
    if (await removePathIfExists(path)) removedPaths.push(path)
  }

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
  ]
}

async function collectInstalledAgentPaths(codexHome: string): Promise<readonly string[]> {
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
  for (const manifestPath of manifestPaths) {
    for (const path of await readInstalledAgentManifest(manifestPath)) {
      paths.add(path)
    }
  }
  return [...paths].sort()
}

async function readInstalledAgentManifest(manifestPath: string): Promise<readonly string[]> {
  if (!(await exists(manifestPath))) return []
  const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"))
  if (!isRecord(parsed) || !Array.isArray(parsed.agents)) return []
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

async function removePathIfExists(path: string): Promise<boolean> {
  if (!(await exists(path))) return false
  await rm(path, { recursive: true, force: true })
  return true
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
