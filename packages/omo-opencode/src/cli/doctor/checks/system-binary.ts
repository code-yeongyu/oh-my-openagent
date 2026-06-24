import { existsSync, accessSync, constants } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { extractSemverFromOutput } from "../../../shared/extract-semver"
import { bunWhich } from "../../../shared/bun-which-shim"
import { spawnWithTimeout } from "../framework/spawn-with-timeout"

import { OPENCODE_BINARIES } from "../framework/constants"

export { extractSemverFromOutput }

const WINDOWS_EXECUTABLE_EXTS = [".exe", ".cmd", ".bat", ".ps1"]

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch (error) {
    if (error instanceof Error) {
      return false
    }

    return false
  }
}

export interface OpenCodeBinaryInfo {
  binary: string
  path: string
}

export function getDesktopAppPaths(platform: NodeJS.Platform): string[] {
  const home = homedir()

  switch (platform) {
    case "darwin":
      return [
        "/Applications/OpenCode.app/Contents/MacOS/OpenCode",
        join(home, "Applications", "OpenCode.app", "Contents", "MacOS", "OpenCode"),
      ]
    case "win32": {
      const programFiles = process.env.ProgramFiles
      const localAppData = process.env.LOCALAPPDATA
      const paths: string[] = []

      if (programFiles) {
        paths.push(join(programFiles, "OpenCode", "OpenCode.exe"))
      }
      if (localAppData) {
        paths.push(join(localAppData, "OpenCode", "OpenCode.exe"))
      }

      return paths
    }
    case "linux":
      return [
        "/usr/bin/opencode",
        "/usr/lib/opencode/opencode",
        join(home, "Applications", "opencode-desktop-linux-x86_64.AppImage"),
        join(home, "Applications", "opencode-desktop-linux-aarch64.AppImage"),
      ]
    default:
      return []
  }
}

export function getBinaryLookupCommand(platform: NodeJS.Platform): "which" | "where" {
  return platform === "win32" ? "where" : "which"
}

export function parseBinaryPaths(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function selectBinaryPath(paths: string[], platform: NodeJS.Platform): string | null {
  if (paths.length === 0) return null
  if (platform !== "win32") return paths[0] ?? null

  const normalizedPaths = paths.map((path) => path.toLowerCase())
  for (const extension of WINDOWS_EXECUTABLE_EXTS) {
    const pathIndex = normalizedPaths.findIndex((path) => path.endsWith(extension))
    if (pathIndex !== -1) {
      return paths[pathIndex] ?? null
    }
  }

  return paths[0] ?? null
}

export function buildVersionCommand(binaryPath: string, platform: NodeJS.Platform): string[] {
  if (platform === "win32" && binaryPath.toLowerCase().endsWith(".ps1")) {
    return ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", binaryPath, "--version"]
  }

  return [binaryPath, "--version"]
}

export function findDesktopBinary(
  platform: NodeJS.Platform = process.platform,
  checkExists: (path: string) => boolean = existsSync
): OpenCodeBinaryInfo | null {
  for (const desktopPath of getDesktopAppPaths(platform)) {
    if (checkExists(desktopPath)) {
      return { binary: "opencode", path: desktopPath }
    }
  }

  return null
}

export async function findOpenCodeBinary(
  platform: NodeJS.Platform = process.platform,
  checkExists: (path: string) => boolean = existsSync,
): Promise<OpenCodeBinaryInfo | null> {
  for (const binary of OPENCODE_BINARIES) {
    const path = bunWhich(binary)
    if (path && checkExists(path)) {
      return { binary, path }
    }
  }

  // 2) Manually search through PATH directories (robust for WSL/mixed environments)
  const pathEnv = process.env.PATH ?? ""
  const delimiter = platform === "win32" ? ";" : ":"
  const candidates = getCommandCandidates(platform)

  for (const entry of pathEnv.split(delimiter).filter(Boolean)) {
    for (const command of candidates) {
      const fullPath = join(entry, command)
      if (checkExists(fullPath) && isExecutable(fullPath)) {
        return { binary: command, path: fullPath }
      }
    }
  }

  // 3) Fall back to desktop app paths
  return findDesktopBinary(platform, checkExists)
}

function getCommandCandidates(platform: NodeJS.Platform): string[] {
  if (platform !== "win32") return [...OPENCODE_BINARIES]

  const WINDOWS_SUFFIXES = ["", ...WINDOWS_EXECUTABLE_EXTS] as const
  return OPENCODE_BINARIES.flatMap((command) =>
    WINDOWS_SUFFIXES.map((suffix) => `${command}${suffix}`),
  )
}

export async function getOpenCodeVersion(
  binaryPath: string,
  platform: NodeJS.Platform = process.platform
): Promise<string | null> {
  try {
    const command = buildVersionCommand(binaryPath, platform)
    const result = await spawnWithTimeout(command, { stdout: "pipe", stderr: "pipe" })
    if (result.timedOut || result.exitCode !== 0) return null
    return extractSemverFromOutput(result.stdout)
  } catch (error) {
    if (error instanceof Error) {
      return null
    }

    return null
  }
}

export function compareVersions(current: string, minimum: string): boolean {
  const parseVersion = (version: string): number[] =>
    version
      .replace(/^v/, "")
      .split("-")[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0)

  const currentParts = parseVersion(current)
  const minimumParts = parseVersion(minimum)
  const length = Math.max(currentParts.length, minimumParts.length)

  for (let index = 0; index < length; index++) {
    const currentPart = currentParts[index] ?? 0
    const minimumPart = minimumParts[index] ?? 0
    if (currentPart > minimumPart) return true
    if (currentPart < minimumPart) return false
  }

  return true
}
