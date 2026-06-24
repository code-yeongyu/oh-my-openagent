import { copyFile, lstat, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { escapeRegExp, findTomlSection, removeSetting } from "./toml-section-editor"

const LEGACY_AGENT_CONFLICT_KEYS = ["max_threads"] as const
const PROJECT_LOCAL_ARTIFACT_PATHS = [
  ".codex/hooks.json",
  ".codex/agents",
  ".codex/prompts",
  ".codex/skills",
] as const

type LegacyAgentConflictKey = (typeof LEGACY_AGENT_CONFLICT_KEYS)[number]

export interface ProjectLocalCodexConfigCleanup {
  readonly projectRoot: string
  readonly configPath: string
  readonly changed: boolean
  readonly removedKeys: readonly LegacyAgentConflictKey[]
  readonly backupPath?: string
}

export interface ProjectLocalCodexArtifact {
  readonly relativePath: string
  readonly path: string
  readonly kind: "directory" | "file" | "other"
}

export interface ProjectLocalCodexCleanupResult {
  readonly projectRoot: string | null
  readonly configPath: string | null
  readonly changed: boolean
  readonly removedKeys: readonly LegacyAgentConflictKey[]
  readonly backupPath?: string
  readonly configs: readonly ProjectLocalCodexConfigCleanup[]
  readonly artifacts: readonly ProjectLocalCodexArtifact[]
}

export async function repairNearestProjectLocalCodexArtifacts(input: {
  readonly startDirectory?: string
  readonly codexHome?: string
  readonly now?: () => Date
}): Promise<ProjectLocalCodexCleanupResult> {
  if (input.startDirectory === undefined) {
    return emptyProjectLocalCodexCleanupResult()
  }
  const project = await findProjectLocalCodexConfigs(input.startDirectory, input.codexHome)
  if (project === null) {
    return emptyProjectLocalCodexCleanupResult()
  }

  const artifacts = await collectProjectLocalArtifacts(project.artifactRoots)
  const configs: ProjectLocalCodexConfigCleanup[] = []
  for (const configPath of project.configPaths) {
    const original = await readFile(configPath, "utf8")
    const repair = repairProjectLocalCodexConfigText(original)
    if (!repair.changed) {
      configs.push({
        projectRoot: project.projectRoot,
        configPath,
        changed: false,
        removedKeys: repair.removedKeys,
      })
      continue
    }

    const backupPath = `${configPath}.backup-${formatBackupTimestamp(input.now?.() ?? new Date())}`
    await copyFile(configPath, backupPath)
    await writeFile(configPath, `${repair.config.trimEnd()}\n`)
    configs.push({
      projectRoot: project.projectRoot,
      configPath,
      changed: true,
      removedKeys: repair.removedKeys,
      backupPath,
    })
  }

  const changedConfigs = configs.filter((config) => config.changed)
  const nearestChangedConfig = lastValue(changedConfigs)
  const nearestConfig = lastValue(configs)
  return {
    projectRoot: project.projectRoot,
    configPath: nearestChangedConfig?.configPath ?? nearestConfig?.configPath ?? null,
    changed: changedConfigs.length > 0,
    removedKeys: uniqueRemovedKeys(changedConfigs),
    backupPath: nearestChangedConfig?.backupPath,
    configs,
    artifacts,
  }
}

export function emptyProjectLocalCodexCleanupResult(): ProjectLocalCodexCleanupResult {
  return {
    projectRoot: null,
    configPath: null,
    changed: false,
    removedKeys: [],
    configs: [],
    artifacts: [],
  }
}

function uniqueRemovedKeys(configs: readonly ProjectLocalCodexConfigCleanup[]): readonly LegacyAgentConflictKey[] {
  const keys: LegacyAgentConflictKey[] = []
  for (const config of configs) {
    for (const key of config.removedKeys) {
      if (!keys.includes(key)) keys.push(key)
    }
  }
  return keys
}

function lastValue<T>(values: readonly T[]): T | null {
  return values.length > 0 ? values[values.length - 1] ?? null : null
}

export function repairProjectLocalCodexConfigText(config: string): {
  readonly config: string
  readonly changed: boolean
  readonly removedKeys: readonly LegacyAgentConflictKey[]
} {
  if (!isMultiAgentV2Enabled(config)) return { config, changed: false, removedKeys: [] }

  let nextConfig = config
  const removedKeys: LegacyAgentConflictKey[] = []
  for (const key of LEGACY_AGENT_CONFLICT_KEYS) {
    const section = findTomlSection(nextConfig, "agents")
    if (section === null || !hasSetting(section.text, key)) continue
    nextConfig = removeSetting(nextConfig, section, key)
    removedKeys.push(key)
  }

  return {
    config: nextConfig,
    changed: removedKeys.length > 0,
    removedKeys,
  }
}

async function findProjectLocalCodexConfigs(
  startDirectory: string,
  codexHome: string | undefined,
): Promise<{
  readonly projectRoot: string
  readonly configPaths: readonly string[]
  readonly artifactRoots: readonly string[]
} | null> {
  if (startDirectory.includes("\0")) return null

  const startDirectoryStat = await maybeLstat(startDirectory)
  if (startDirectoryStat !== null && !startDirectoryStat.isDirectory()) {
    throw new ProjectLocalCleanupStartDirectoryError(startDirectory)
  }

  const codexHomeConfigPath = codexHome === undefined ? null : join(resolve(codexHome), "config.toml")
  let current = resolve(startDirectory)
  const configPathsFromCwd: string[] = []
  while (true) {
    const configPath = join(current, ".codex", "config.toml")
    if (await isRegularProjectLocalConfig(current, configPath)) {
      if (codexHomeConfigPath === null || resolve(configPath) !== codexHomeConfigPath) {
        configPathsFromCwd.push(configPath)
      }
    }

    if (await exists(join(current, ".git"))) {
      return configPathsFromCwd.length === 0
        ? null
        : {
            projectRoot: current,
            configPaths: [...configPathsFromCwd].reverse(),
            artifactRoots: artifactRootsForConfigPaths(configPathsFromCwd),
          }
    }

    const parent = dirname(current)
    if (parent === current) {
      const nearestConfigPath = configPathsFromCwd[0]
      return nearestConfigPath === undefined
        ? null
        : {
            projectRoot: dirname(dirname(nearestConfigPath)),
            configPaths: [nearestConfigPath],
            artifactRoots: [dirname(dirname(nearestConfigPath))],
          }
    }
    current = parent
  }
}

async function isRegularProjectLocalConfig(directory: string, configPath: string): Promise<boolean> {
  const codexDirStat = await maybeLstat(join(directory, ".codex"))
  if (codexDirStat === null || !codexDirStat.isDirectory() || codexDirStat.isSymbolicLink()) return false
  const configStat = await maybeLstat(configPath)
  return configStat !== null && configStat.isFile() && !configStat.isSymbolicLink()
}

function artifactRootsForConfigPaths(configPaths: readonly string[]): readonly string[] {
  const roots: string[] = []
  for (const configPath of configPaths) {
    const root = dirname(dirname(configPath))
    if (!roots.includes(root)) roots.push(root)
  }
  return roots.reverse()
}

async function collectProjectLocalArtifacts(projectRoots: readonly string[]): Promise<readonly ProjectLocalCodexArtifact[]> {
  const artifacts: ProjectLocalCodexArtifact[] = []
  const seenPaths = new Set<string>()
  for (const projectRoot of projectRoots) {
    for (const relativePath of PROJECT_LOCAL_ARTIFACT_PATHS) {
      const artifactPath = join(projectRoot, relativePath)
      if (seenPaths.has(artifactPath)) continue
      const entryStat = await maybeLstat(artifactPath)
      if (entryStat === null) continue
      seenPaths.add(artifactPath)
      artifacts.push({
        relativePath,
        path: artifactPath,
        kind: entryStat.isDirectory() ? "directory" : entryStat.isFile() ? "file" : "other",
      })
    }
  }
  return artifacts
}

function isMultiAgentV2Enabled(config: string): boolean {
  const featuresSection = findTomlSection(config, "features")
  if (featuresSection !== null && settingIsBooleanTrue(featuresSection.text, "multi_agent_v2")) return true

  const multiAgentSection = findTomlSection(config, "features.multi_agent_v2")
  return multiAgentSection !== null && settingIsBooleanTrue(multiAgentSection.text, "enabled")
}

function settingIsBooleanTrue(sectionText: string, key: string): boolean {
  return new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*true\\s*(?:#.*)?$`, "m").test(sectionText)
}

function hasSetting(sectionText: string, key: string): boolean {
  return new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`, "m").test(sectionText)
}

function formatBackupTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-")
}

async function maybeLstat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path)
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return null
    throw error
  }
}

async function exists(path: string): Promise<boolean> {
  return (await maybeLstat(path)) !== null
}

function nodeErrorCode(error: unknown): string | null {
  if (!(error instanceof Error) || !("code" in error)) return null
  return typeof error.code === "string" ? error.code : null
}

class ProjectLocalCleanupStartDirectoryError extends Error {
  constructor(startDirectory: string) {
    super(`Project-local Codex cleanup start path is not a directory: ${startDirectory}`)
    this.name = "ProjectLocalCleanupStartDirectoryError"
  }
}
