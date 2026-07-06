import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { DEFAULT_READ_FILE_SYSTEM, type OmoConfigEnv, type OmoConfigReadFileSystem } from "./types"

export type OmoConfigPathCandidate = {
  readonly path: string
  readonly scope: "project" | "user"
}

export type ResolveOmoConfigPathsOptions = {
  readonly cwd: string
  readonly env?: OmoConfigEnv
  readonly fileSystem?: OmoConfigReadFileSystem
  readonly platform?: NodeJS.Platform
}

function containsPath(parent: string, child: string): boolean {
  const pathToChild = relative(parent, child)
  return pathToChild === "" || (!pathToChild.startsWith("..") && !isAbsolute(pathToChild))
}

export function resolveHomeDir(env: OmoConfigEnv = process.env): string {
  return resolve(env.HOME ?? env.USERPROFILE ?? process.cwd())
}

export function resolveUserOmoConfigPath(
  env: OmoConfigEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32" && env.APPDATA !== undefined && env.APPDATA.length > 0) {
    return join(env.APPDATA, "omo", "omo.jsonc")
  }
  if (env.XDG_CONFIG_HOME !== undefined && env.XDG_CONFIG_HOME.length > 0) {
    return join(env.XDG_CONFIG_HOME, "omo", "omo.jsonc")
  }
  return join(resolveHomeDir(env), ".config", "omo", "omo.jsonc")
}

function detectOmoJsonPath(dir: string, fileSystem: OmoConfigReadFileSystem): string | null {
  const jsoncPath = join(dir, ".omo", "omo.jsonc")
  if (fileSystem.existsSync(jsoncPath)) return jsoncPath
  const jsonPath = join(dir, ".omo", "omo.json")
  return fileSystem.existsSync(jsonPath) ? jsonPath : null
}

function findProjectConfigPathsFarthestFirst(
  cwd: string,
  homeDir: string,
  fileSystem: OmoConfigReadFileSystem,
): readonly string[] {
  const startDir = resolve(cwd)
  const stopDir = containsPath(resolve(homeDir), startDir) ? resolve(homeDir) : null
  const nearestFirst: string[] = []
  let currentDir = startDir

  while (true) {
    const configPath = detectOmoJsonPath(currentDir, fileSystem)
    if (configPath !== null) nearestFirst.push(configPath)
    if (stopDir !== null && currentDir === stopDir) break
    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) break
    currentDir = parentDir
  }

  return nearestFirst.reverse()
}

export function resolveOmoConfigPaths(options: ResolveOmoConfigPathsOptions): readonly OmoConfigPathCandidate[] {
  const fileSystem = options.fileSystem ?? DEFAULT_READ_FILE_SYSTEM
  const env = options.env ?? process.env
  const userPath = resolveUserOmoConfigPath(env, options.platform ?? process.platform)
  const projectPaths = findProjectConfigPathsFarthestFirst(options.cwd, resolveHomeDir(env), fileSystem)
  return [
    { path: userPath, scope: "user" },
    ...projectPaths.map((path): OmoConfigPathCandidate => ({ path, scope: "project" })),
  ]
}
