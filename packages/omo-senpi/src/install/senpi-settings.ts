import { constants } from "node:fs"
import { access, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

export type SettingsRecord = Record<string, unknown>

const OMO_SENPI_PACKAGE_NAME = "@code-yeongyu/omo-senpi"

const LEGACY_BUILTIN_SHADOW_PACKAGES = [
  join("packages", "pi-goal"),
  join("packages", "pi-webfetch"),
] as const

export async function readSettings(settingsPath: string): Promise<SettingsRecord> {
  let raw: string
  try {
    raw = await readFile(settingsPath, "utf8")
  } catch (error) {
    if (isErrno(error, "ENOENT")) return {}
    throw error
  }

  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed)) throw new Error(`${settingsPath} must contain a JSON object`)
  return parsed
}

export function readPackages(settings: SettingsRecord): string[] {
  const packages = settings.packages
  if (packages === undefined) return []
  if (!Array.isArray(packages) || !packages.every((entry) => typeof entry === "string")) {
    throw new Error("Senpi settings packages must be an array of strings")
  }
  return packages
}

export function dedupePackages(packages: readonly string[]): string[] {
  return [...new Set(packages)]
}

export function removeLegacyBuiltinShadows(
  packages: readonly string[],
  repoRoot: string,
  agentDir: string,
): string[] {
  const shadowPaths = new Set(LEGACY_BUILTIN_SHADOW_PACKAGES.map((path) => resolve(repoRoot, path)))
  return packages.filter((entry) => !shadowPaths.has(resolve(agentDir, entry)))
}

export async function removeSupersededOmoPackages(
  packages: readonly string[],
  currentPluginPath: string,
  agentDir: string,
): Promise<string[]> {
  const currentPath = resolve(currentPluginPath)
  const entries = await Promise.all(
    packages.map(async (entry) => {
      const packagePath = resolve(agentDir, entry)
      if (packagePath === currentPath) return currentPath
      return (await readPackageName(packagePath)) === OMO_SENPI_PACKAGE_NAME ? undefined : entry
    }),
  )
  return entries.filter((entry): entry is string => entry !== undefined)
}

export async function writeSettingsAtomically(
  settingsPath: string,
  settings: SettingsRecord,
): Promise<string> {
  await mkdir(dirname(settingsPath), { recursive: true })
  const backupPath = await nextBackupPath(settingsPath)
  if (await fileExists(settingsPath)) {
    await copyFile(settingsPath, backupPath)
  } else {
    await writeFile(backupPath, "{}\n", "utf8")
  }

  const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8")
  await rename(tempPath, settingsPath)
  return backupPath
}

async function nextBackupPath(settingsPath: string): Promise<string> {
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? "" : `-${index}`
    const candidate = `${settingsPath}.${timestampForBackup()}${suffix}.backup`
    if (!(await fileExists(candidate))) return candidate
  }
  throw new Error(`Unable to allocate backup path for ${settingsPath}`)
}

function timestampForBackup(): string {
  return new Date().toISOString().replace(/[-:.]/g, "")
}

export function isRecord(value: unknown): value is SettingsRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function readPackageName(packagePath: string): Promise<string | undefined> {
  let raw: string
  try {
    raw = await readFile(join(packagePath, "package.json"), "utf8")
  } catch (error) {
    if (isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR")) return undefined
    throw error
  }
  const parsed: unknown = JSON.parse(raw)
  return isRecord(parsed) && typeof parsed.name === "string" ? parsed.name : undefined
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false
    throw error
  }
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code
}
