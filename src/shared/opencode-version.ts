import { execSync } from "child_process"
import { existsSync, readFileSync, realpathSync } from "fs"
import { dirname, join } from "path"

/**
 * Minimum OpenCode version required for this plugin.
 * This plugin only supports OpenCode 1.1.1+ which uses the permission system.
 */
export const MINIMUM_OPENCODE_VERSION = "1.1.1"

/**
 * OpenCode version that introduced native AGENTS.md injection.
 * PR #10678 merged on Jan 26, 2026 - OpenCode now dynamically resolves
 * AGENTS.md files from subdirectories as the agent explores them.
 * When this version is detected, the directory-agents-injector hook
 * is auto-disabled to prevent duplicate AGENTS.md loading.
 */
export const OPENCODE_NATIVE_AGENTS_INJECTION_VERSION = "1.1.37"

/**
 * OpenCode version that introduced SQLite backend for storage.
 * When this version is detected AND opencode.db exists, SQLite backend is used.
 */
export const OPENCODE_SQLITE_VERSION = "1.1.53"

const NOT_CACHED = Symbol("NOT_CACHED")
let cachedVersion: string | null | typeof NOT_CACHED = NOT_CACHED

type RuntimeWithBun = typeof globalThis & {
  Bun?: {
    which(binary: string): string | null
  }
}

type ExecCommandOptions = {
  encoding: "utf-8"
  timeout: number
  stdio: ["pipe", "pipe", "pipe"]
}

export type OpenCodeVersionDeps = {
  execCommand: (command: string, options: ExecCommandOptions) => string
  getBinaryPath: () => string | null
  exists: (filePath: string) => boolean
  realpath: (filePath: string) => string
  readText: (filePath: string) => string
}

const defaultDeps: OpenCodeVersionDeps = {
  execCommand: (command, options) => execSync(command, options),
  getBinaryPath: () => {
    const envPath = process.env.OPENCODE_BIN_PATH
    if (envPath) return envPath
    return (globalThis as RuntimeWithBun).Bun?.which("opencode") ?? null
  },
  exists: existsSync,
  realpath: realpathSync,
  readText: (filePath) => readFileSync(filePath, "utf-8"),
}

export function parseVersion(version: string): number[] {
  const cleaned = version.replace(/^v/, "").split("-")[0]
  return cleaned.split(".").map((n) => parseInt(n, 10) || 0)
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const partsA = parseVersion(a)
  const partsB = parseVersion(b)
  const maxLen = Math.max(partsA.length, partsB.length)

  for (let i = 0; i < maxLen; i++) {
    const numA = partsA[i] ?? 0
    const numB = partsB[i] ?? 0
    if (numA < numB) return -1
    if (numA > numB) return 1
  }
  return 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parsePackageVersion(content: string): string | null {
  try {
    const parsed: unknown = JSON.parse(content)
    if (!isRecord(parsed)) return null

    const name = parsed.name
    const version = parsed.version
    if (typeof name !== "string" || !name.includes("opencode")) return null
    if (typeof version !== "string" || version.length === 0) return null

    return version
  } catch {
    return null
  }
}

function getPackageVersionFromBinary(binaryPath: string, deps: OpenCodeVersionDeps): string | null {
  try {
    const realBinaryPath = deps.realpath(binaryPath)
    const packagePath = join(dirname(dirname(realBinaryPath)), "package.json")
    if (!deps.exists(packagePath)) return null
    return parsePackageVersion(deps.readText(packagePath))
  } catch {
    return null
  }
}

export function getOpenCodeVersion(deps: Partial<OpenCodeVersionDeps> = {}): string | null {
  if (cachedVersion !== NOT_CACHED) {
    return cachedVersion
  }

  const resolvedDeps: OpenCodeVersionDeps = { ...defaultDeps, ...deps }
  const binaryPath = resolvedDeps.getBinaryPath()
  if (binaryPath) {
    const packageVersion = getPackageVersionFromBinary(binaryPath, resolvedDeps)
    if (packageVersion) {
      cachedVersion = packageVersion
      return cachedVersion
    }
  }

  try {
    const result = resolvedDeps.execCommand("opencode --version", {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()

    const versionMatch = result.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/)
    cachedVersion = versionMatch?.[1] ?? null
    return cachedVersion
  } catch {
    cachedVersion = null
    return null
  }
}

export function isOpenCodeVersionAtLeast(version: string): boolean {
  const current = getOpenCodeVersion()
  if (!current) return true
  return compareVersions(current, version) >= 0
}

export function resetVersionCache(): void {
  cachedVersion = NOT_CACHED
}

export function setVersionCache(version: string | null): void {
  cachedVersion = version
}
