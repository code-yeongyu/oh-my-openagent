import { accessSync, constants, mkdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"

export interface XdgOsProvider {
  readonly homedir: () => string
  readonly tmpdir: () => string
}

export interface ResolveXdgDataDirOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly osProvider?: XdgOsProvider
}

export function resolveXdgDataDir(
  appName: string,
  options: ResolveXdgDataDirOptions = {}
): string {
  const osProvider = options.osProvider ?? os
  const env = options.env ?? process.env
  const preferredDir = env.XDG_DATA_HOME ?? path.join(osProvider.homedir(), ".local", "share")
  return resolveWritableDirectory(preferredDir, `${appName}-data`, osProvider)
}

function resolveWritableDirectory(
  preferredDir: string,
  fallbackSuffix: string,
  osProvider: XdgOsProvider
): string {
  try {
    mkdirSync(preferredDir, { recursive: true })
    accessSync(preferredDir, constants.W_OK)
    return preferredDir
  } catch (error) {
    if (!(error instanceof Error)) throw error
    const fallbackDir = path.join(osProvider.tmpdir(), fallbackSuffix)
    mkdirSync(fallbackDir, { recursive: true })
    return fallbackDir
  }
}
