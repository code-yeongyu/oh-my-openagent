import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { downloadAndInstallRipgrep, getInstalledRipgrepPath } from "../tools/grep/downloader"
import { getDataDir } from "./data-path"
import { log } from "./logger"
import { PUBLISHED_PACKAGE_NAME } from "./plugin-identity"

export type GrepBackend = "rg" | "grep"

export interface ResolvedCli {
  path: string
  backend: GrepBackend
}

export const DEFAULT_RG_THREADS = 4

let cachedCli: ResolvedCli | null = null
let autoInstallAttempted = false

function findExecutable(name: string): string | null {
  const isWindows = process.platform === "win32"
  const cmd = isWindows ? "where" : "which"

  try {
    const result = spawnSync(cmd, [name], { encoding: "utf-8", timeout: 5000 })
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim().split("\n")[0]
    }
  } catch {
    return null
  }
  return null
}

function getOpenCodeBundledRg(): string | null {
  const execPath = process.execPath
  const execDir = dirname(execPath)

  const isWindows = process.platform === "win32"
  const rgName = isWindows ? "rg.exe" : "rg"

  const candidates = [
    join(getDataDir(), "opencode", "bin", rgName),
    join(execDir, rgName),
    join(execDir, "bin", rgName),
    join(execDir, "..", "bin", rgName),
    join(execDir, "..", "libexec", rgName),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

export function resolveGrepCli(): ResolvedCli {
  if (cachedCli) {
    return cachedCli
  }

  const rgPath = getOpenCodeBundledRg() ?? findExecutable("rg") ?? getInstalledRipgrepPath()
  if (rgPath) {
    cachedCli = { path: rgPath, backend: "rg" }
    return cachedCli
  }

  const grep = findExecutable("grep")
  if (grep) {
    cachedCli = { path: grep, backend: "grep" }
    return cachedCli
  }

  cachedCli = { path: "rg", backend: "rg" }
  return cachedCli
}

export async function resolveGrepCliWithAutoInstall(): Promise<ResolvedCli> {
  const current = resolveGrepCli()

  if (current.backend === "rg" && current.path !== "rg") {
    return current
  }

  if (autoInstallAttempted) {
    return current
  }

  autoInstallAttempted = true

  try {
    const rgPath = await downloadAndInstallRipgrep()
    cachedCli = { path: rgPath, backend: "rg" }
    return cachedCli
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (current.backend === "grep") {
      log(`[${PUBLISHED_PACKAGE_NAME}] Failed to auto-install ripgrep. Falling back to GNU grep.`, {
        error: message,
        grep_path: current.path,
      })
    } else {
      log(`[${PUBLISHED_PACKAGE_NAME}] Failed to auto-install ripgrep and GNU grep was not found.`, {
        error: message,
      })
    }

    return current
  }
}
