import { existsSync, lstatSync, realpathSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { getOpenCodeConfigDirs, getOpenCodeConfigDiscoveryDirs, type OpenCodeConfigDirOptions } from "../shared"

export type MisplacedCategoryDiagnosticOptions = {
  readonly accountHomeDirectory?: string
  readonly disableProjectConfig?: boolean
  readonly homeDirectory?: string
  readonly maxProjectDepth?: number
  readonly openCodeHost?: OpenCodeConfigDirOptions
  readonly worktreeDirectory?: string
}
export type ConfigCandidate = {
  readonly filePath: string
  readonly priority: number
  readonly targetConfigPath: string
}

type RequiredDiscoveryOptions = "accountHomeDirectory" | "disableProjectConfig"
  | "homeDirectory" | "maxProjectDepth" | "openCodeHost"
type ConfigDiscoveryOptions =
  & Required<Pick<MisplacedCategoryDiagnosticOptions, RequiredDiscoveryOptions>>
  & Pick<MisplacedCategoryDiagnosticOptions, "worktreeDirectory">

function pathKey(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/")
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function canonicalPath(filePath: string): string {
  const absolutePath = resolve(filePath)
  try {
    return realpathSync(absolutePath)
  } catch {
    return absolutePath
  }
}

function ancestorDirectories(
  directory: string, boundaryDirectories: readonly string[], maxDepth: number,
): string[] {
  const directories: string[] = []
  const lexicalBoundaryKeys = new Set(
    boundaryDirectories.map((path) => pathKey(resolve(path))),
  )
  const canonicalBoundaryKeys = new Set(
    boundaryDirectories.map((path) => pathKey(canonicalPath(path))),
  )
  let current = resolve(directory)
  for (let depth = 0; depth < maxDepth; depth += 1) {
    directories.push(current)
    if (
      lexicalBoundaryKeys.has(pathKey(current)) ||
      canonicalBoundaryKeys.has(pathKey(canonicalPath(current)))
    ) {
      break
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return directories.reverse()
}

function isSymlinkedPath(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink()
  } catch (error) {
    if (
      error instanceof Error &&
      (Reflect.get(error, "code") === "ENOENT" || Reflect.get(error, "code") === "ENOTDIR")
    ) {
      return false
    }
    if (error instanceof Error) return true
    throw error
  }
}

function activeOmoConfigPath(configDirectory: string): string {
  const jsoncPath = join(configDirectory, "omo.jsonc")
  if (existsSync(jsoncPath)) return jsoncPath
  const jsonPath = join(configDirectory, "omo.json")
  return existsSync(jsonPath) ? jsonPath : jsoncPath
}

function projectOmoTargetPath(projectDirectory: string): string {
  const configDirectory = join(projectDirectory, ".omo")
  const jsoncPath = join(configDirectory, "omo.jsonc")
  const jsonPath = join(configDirectory, "omo.json")
  if (isSymlinkedPath(configDirectory)) {
    return `${targetPath(jsoncPath, undefined)} after replacing the symlinked ${configDirectory} directory`
  }
  if (existsSync(jsoncPath) && !isSymlinkedPath(jsoncPath)) {
    return targetPath(jsoncPath, undefined)
  }
  if (existsSync(jsonPath) && !isSymlinkedPath(jsonPath)) {
    return targetPath(jsonPath, undefined)
  }
  if (isSymlinkedPath(jsoncPath) && isSymlinkedPath(jsonPath)) {
    return `${targetPath(jsoncPath, undefined)} after replacing the symlinked config files in ${configDirectory}`
  }
  return targetPath(isSymlinkedPath(jsoncPath) ? jsonPath : jsoncPath, undefined)
}

export function userOmoTargetPath(homeDirectory: string): string {
  const filename = basename(activeOmoConfigPath(join(homeDirectory, ".omo")))
  return `~/.omo/${filename}`
}

const formatConfigKey = (key: string): string => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key)
export function targetPath(basePath: string, profileName: string | undefined): string {
  return profileName === undefined
    ? `${basePath} under "[opencode]".categories`
    : `${basePath} under profiles.${formatConfigKey(profileName)}."[opencode]".categories`
}

function isProfileConfigDirectory(configDirectory: string): boolean {
  const configuredDirectory = process.env.OPENCODE_CONFIG_DIR?.trim()
  if (
    configuredDirectory === undefined ||
    !/(?:^|[\\/])profiles[\\/][^\\/]+[\\/]*$/.test(configuredDirectory)
  ) {
    return false
  }
  return pathKey(canonicalPath(configuredDirectory)) ===
    pathKey(canonicalPath(configDirectory))
}

function existingOpenCodeConfigFiles(configDirectory: string): string[] {
  return ["opencode.json", "opencode.jsonc"]
    .map((filename) => join(configDirectory, filename))
    .filter((filePath) => existsSync(filePath))
}

export function getMisplacedCategoryConfigCandidates(
  projectDirectory: string, options: ConfigDiscoveryOptions, profileName: string | undefined,
): ConfigCandidate[] {
  const candidates = new Map<string, ConfigCandidate>()
  const add = (filePath: string, targetConfigPath: string, priority: number): void => {
    const key = pathKey(canonicalPath(filePath))
    const existing = candidates.get(key)
    if (existing !== undefined && existing.priority >= priority) return
    candidates.set(key, { filePath, priority, targetConfigPath })
  }
  const baseUserTarget = targetPath(userOmoTargetPath(options.homeDirectory), undefined)
  const profileUserTarget = targetPath(userOmoTargetPath(options.homeDirectory), profileName)

  for (const configDirectory of getOpenCodeConfigDiscoveryDirs(options.openCodeHost)) {
    const target = profileName !== undefined && isProfileConfigDirectory(configDirectory)
      ? profileUserTarget
      : baseUserTarget
    for (const filePath of existingOpenCodeConfigFiles(configDirectory)) {
      add(filePath, target, 0)
    }
  }
  const defaultCliConfigDirectory = getOpenCodeConfigDirs({ binary: "opencode" }).at(-1)
  const legacyConfig = defaultCliConfigDirectory === undefined
    ? undefined
    : join(defaultCliConfigDirectory, "config.json")
  if (legacyConfig !== undefined && existsSync(legacyConfig)) {
    add(legacyConfig, baseUserTarget, 0)
  }
  const homeOpenCodeDirectory = join(options.homeDirectory, ".opencode")
  for (const filePath of existingOpenCodeConfigFiles(homeOpenCodeDirectory)) {
    add(filePath, baseUserTarget, 0)
  }
  const explicitConfig = process.env.OPENCODE_CONFIG?.trim()
  if (explicitConfig && existsSync(resolve(explicitConfig))) {
    add(resolve(explicitConfig), baseUserTarget, 0)
  }
  if (options.disableProjectConfig) return [...candidates.values()]

  const homeKeys = new Set(
    [options.homeDirectory, options.accountHomeDirectory]
      .map((path) => pathKey(canonicalPath(path))),
  )
  const boundaries = [
    options.homeDirectory,
    options.accountHomeDirectory,
    ...(options.worktreeDirectory === undefined ? [] : [options.worktreeDirectory]),
  ]
  const ancestors = ancestorDirectories(
    projectDirectory,
    boundaries,
    options.maxProjectDepth,
  )
  for (const directory of ancestors) {
    const target = homeKeys.has(pathKey(canonicalPath(directory)))
      ? baseUserTarget
      : projectOmoTargetPath(directory)
    for (const filePath of existingOpenCodeConfigFiles(directory)) {
      add(filePath, target, 1)
    }
    for (const filePath of existingOpenCodeConfigFiles(join(directory, ".opencode"))) {
      add(filePath, target, 1)
    }
  }
  return [...candidates.values()]
}
