import { existsSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { join, posix, resolve, win32 } from "node:path"

import { CONFIG_BASENAME } from "./plugin-identity"

import type {
  OpenCodeBinaryType,
  OpenCodeConfigDirOptions,
  OpenCodeConfigPaths,
} from "./opencode-config-dir-types"

export type {
  OpenCodeBinaryType,
  OpenCodeConfigDirOptions,
  OpenCodeConfigPaths,
} from "./opencode-config-dir-types"

export const TAURI_APP_IDENTIFIER = "ai.opencode.desktop"
export const TAURI_APP_IDENTIFIER_DEV = "ai.opencode.desktop.dev"

export function isDevBuild(version: string | null | undefined): boolean {
  if (!version) return false
  return version.includes("-dev") || version.includes(".dev")
}

function getTauriConfigDir(identifier: string): string {
  const platform = process.platform

  switch (platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", identifier)

    case "win32": {
      const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming")
      return win32.join(appData, identifier)
    }

    case "linux":
    default: {
      const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
      return join(xdgConfig, identifier)
    }
  }
}

function resolveConfigPath(pathValue: string): string {
  if (isWslEnvironment() && pathValue.startsWith("/")) {
    return posix.normalize(pathValue)
  }

  const resolvedPath = resolve(pathValue)
  if (!existsSync(resolvedPath)) return resolvedPath

  try {
    return realpathSync(resolvedPath)
  } catch (error) {
    if (error instanceof Error) {
      return resolvedPath
    }
    return resolvedPath
  }
}

function isWslEnvironment(): boolean {
  return process.platform === "linux" &&
    (Boolean(process.env.WSL_DISTRO_NAME?.trim()) || Boolean(process.env.WSL_INTEROP?.trim()))
}

function isWindowsUserConfigRoot(pathValue: string): boolean {
  const normalizedPath = pathValue.replaceAll("\\", "/").toLowerCase()
  return /^[a-z]:\/users\//.test(normalizedPath) || /^\/mnt\/[a-z]\/users\//.test(normalizedPath)
}

function getWindowsUserFromConfigRoot(pathValue: string): string | null {
  const normalizedPath = pathValue.replaceAll("\\", "/")
  const match = /^(?:[a-z]:|\/mnt\/[a-z])\/Users\/([^/]+)/i.exec(normalizedPath)
  return match?.[1] ?? null
}

function getWslLinuxHomeDir(windowsConfigRoot?: string): string | null {
  const envHome = process.env.HOME?.trim()
  if (envHome && envHome.startsWith("/") && !isWindowsUserConfigRoot(envHome)) {
    return envHome
  }

  const user = process.env.USER?.trim() || process.env.LOGNAME?.trim() ||
    process.env.SUDO_USER?.trim() ||
    (windowsConfigRoot ? getWindowsUserFromConfigRoot(windowsConfigRoot) : undefined)
  return user ? posix.join("/home", user) : null
}

function getCliDefaultConfigDir(): string {
  const envXdgConfig = process.env.XDG_CONFIG_HOME?.trim()
  const shouldIgnoreWindowsXdg = envXdgConfig !== undefined && envXdgConfig.length > 0 &&
    isWslEnvironment() && isWindowsUserConfigRoot(envXdgConfig)
  const xdgConfig = shouldIgnoreWindowsXdg
    ? posix.join(getWslLinuxHomeDir(envXdgConfig) ?? "/home", ".config")
    : envXdgConfig || join(homedir(), ".config")
  const configDir = isWslEnvironment() ? posix.join(xdgConfig, "opencode") : join(xdgConfig, "opencode")
  return resolveConfigPath(configDir)
}

function getCliCustomConfigDir(): string | null {
  const envConfigDir = process.env.OPENCODE_CONFIG_DIR?.trim()
  if (!envConfigDir) {
    return null
  }

  return resolveConfigPath(envConfigDir)
}

function getCliConfigDir(): string {
  return getCliCustomConfigDir() ?? getCliDefaultConfigDir()
}

export function getOpenCodeConfigDirs(options: OpenCodeConfigDirOptions): string[] {
  if (options.binary !== "opencode") {
    return [getOpenCodeConfigDir(options)]
  }

  const customConfigDir = getCliCustomConfigDir()

  return Array.from(
    new Set([
      ...(customConfigDir ? [customConfigDir] : []),
      getCliDefaultConfigDir(),
    ]),
  )
}

export function getOpenCodeConfigDir(options: OpenCodeConfigDirOptions): string {
  const { binary, version, checkExisting = true } = options

  if (binary === "opencode") {
    return getCliConfigDir()
  }

  const identifier = isDevBuild(version) ? TAURI_APP_IDENTIFIER_DEV : TAURI_APP_IDENTIFIER
  const tauriDirBase = getTauriConfigDir(identifier)
  const tauriDir = process.platform === "win32"
    ? (win32.isAbsolute(tauriDirBase) ? win32.normalize(tauriDirBase) : win32.resolve(tauriDirBase))
    : resolveConfigPath(tauriDirBase)

  if (checkExisting) {
    const legacyDir = getCliConfigDir()
    const legacyConfig = join(legacyDir, "opencode.json")
    const legacyConfigC = join(legacyDir, "opencode.jsonc")

    if (existsSync(legacyConfig) || existsSync(legacyConfigC)) {
      return legacyDir
    }
  }

  return tauriDir
}

export function getOpenCodeConfigPaths(options: OpenCodeConfigDirOptions): OpenCodeConfigPaths {
  const configDir = getOpenCodeConfigDir(options)

  return {
    configDir,
    configJson: join(configDir, "opencode.json"),
    configJsonc: join(configDir, "opencode.jsonc"),
    packageJson: join(configDir, "package.json"),
    omoConfig: join(configDir, `${CONFIG_BASENAME}.json`),
  }
}

export function detectExistingConfigDir(binary: OpenCodeBinaryType, version?: string | null): string | null {
  const locations: string[] = []

  const envConfigDir = process.env.OPENCODE_CONFIG_DIR?.trim()
  if (envConfigDir) {
    locations.push(resolveConfigPath(envConfigDir))
  }

  if (binary === "opencode-desktop") {
    const identifier = isDevBuild(version) ? TAURI_APP_IDENTIFIER_DEV : TAURI_APP_IDENTIFIER
    locations.push(getTauriConfigDir(identifier))

    if (isDevBuild(version)) {
      locations.push(getTauriConfigDir(TAURI_APP_IDENTIFIER))
    }
  }

  locations.push(getCliConfigDir())

  for (const dir of locations) {
    const configJson = join(dir, "opencode.json")
    const configJsonc = join(dir, "opencode.jsonc")

    if (existsSync(configJson) || existsSync(configJsonc)) {
      return dir
    }
  }

  return null
}
