import { win32 } from "node:path"

import {
  DEFAULT_DISCOVERY_FILE_SYSTEM,
  type ConfigMigrationDiscoveryOptions,
  type ConfigMigrationPathOperations,
} from "./types"

export const CONFIG_FILE_NAMES = [
  "oh-my-openagent.jsonc",
  "oh-my-openagent.json",
  "oh-my-opencode.jsonc",
  "oh-my-opencode.json",
] as const

export function isWindowsPathOperations(options: ConfigMigrationDiscoveryOptions): boolean {
  return options.pathOperations === win32
}

export function discoveryFileSystem(options: ConfigMigrationDiscoveryOptions) {
  return options.fileSystem ?? DEFAULT_DISCOVERY_FILE_SYSTEM
}

export function usesWindowsPathSemantics(options: ConfigMigrationDiscoveryOptions): boolean {
  return options.platform === "win32" || (options.fileSystem === undefined && process.platform === "win32")
}

export function hostPathOperations(options: ConfigMigrationDiscoveryOptions): ConfigMigrationPathOperations {
  return usesWindowsPathSemantics(options) ? win32 : options.pathOperations
}

function comparisonPath(path: string, options: ConfigMigrationDiscoveryOptions): string {
  return usesWindowsPathSemantics(options) ? path.replaceAll("\\", "/").toLowerCase() : path
}

export function canonicalPath(path: string, options: ConfigMigrationDiscoveryOptions): string {
  const normalized = options.pathOperations.normalize(path)
  const resolved = usesWindowsPathSemantics(options) && win32.isAbsolute(normalized)
    ? normalized
    : options.pathOperations.resolve(normalized)
  try {
    return discoveryFileSystem(options).realpathSync(resolved)
  } catch (error) {
    if (error instanceof Error && (Reflect.get(error, "code") === "ENOENT" || Reflect.get(error, "code") === "ENOTDIR")) {
      return resolved
    }
    throw error
  }
}

export function pathKey(path: string, options: ConfigMigrationDiscoveryOptions): string {
  return comparisonPath(canonicalPath(path, options), options)
}

export function configPaths(directory: string, options: ConfigMigrationDiscoveryOptions): readonly string[] {
  return CONFIG_FILE_NAMES
    .map((fileName) => options.pathOperations.join(directory, fileName))
    .filter((path) => discoveryFileSystem(options).existsSync(path))
}

export function profileDirectories(root: string, options: ConfigMigrationDiscoveryOptions): readonly string[] {
  const directory = options.pathOperations.join(root, "profiles")
  try {
    return discoveryFileSystem(options).readdirSync(directory)
  } catch (error) {
    if (error instanceof Error && (Reflect.get(error, "code") === "ENOENT" || Reflect.get(error, "code") === "ENOTDIR")) return []
    throw error
  }
}

function isWithin(parent: string, child: string, options: ConfigMigrationDiscoveryOptions): boolean {
  const pathOperations = hostPathOperations(options)
  const relative = pathOperations.relative(parent, child)
  return relative === "" || (!relative.startsWith("..") && !pathOperations.isAbsolute(relative))
}

export function projectDirectories(options: ConfigMigrationDiscoveryOptions): readonly string[] {
  const directories: string[] = []
  const homeDir = canonicalPath(options.homeDir, options)
  let current = canonicalPath(options.cwd, options)
  const stopAtHome = isWithin(homeDir, current, options)
  for (;;) {
    directories.push(current)
    if (stopAtHome && pathKey(current, options) === pathKey(homeDir, options)) break
    const parent = hostPathOperations(options).dirname(current)
    if (parent === current) break
    current = parent
  }
  return directories
}
