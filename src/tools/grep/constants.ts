import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { spawnSync } from "node:child_process"

export type GrepBackend = "rg" | "grep"

interface ResolvedCli {
  path: string
  backend: GrepBackend
}

let cachedCli: ResolvedCli | null = null

function findExecutable(name: string): string | null {
  const isWindows = process.platform === "win32"
  const cmd = isWindows ? "where" : "which"

  try {
    const result = spawnSync(cmd, [name], { encoding: "utf-8", timeout: 5000 })
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim().split("\n")[0]
    }
  } catch {
    // ignore
  }
  return null
}

function getOpenCodeBundledRg(): string | null {
  // OpenCode binary directory (where opencode executable lives)
  const execPath = process.execPath
  const execDir = dirname(execPath)

  const isWindows = process.platform === "win32"
  const rgName = isWindows ? "rg.exe" : "rg"

  // Check common bundled locations
  const candidates = [
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
  if (cachedCli) return cachedCli

  // Priority 1: OpenCode bundled rg
  const bundledRg = getOpenCodeBundledRg()
  if (bundledRg) {
    cachedCli = { path: bundledRg, backend: "rg" }
    return cachedCli
  }

  // Priority 2: System rg
  const systemRg = findExecutable("rg")
  if (systemRg) {
    cachedCli = { path: systemRg, backend: "rg" }
    return cachedCli
  }

  // Priority 3: grep (fallback)
  const grep = findExecutable("grep")
  if (grep) {
    cachedCli = { path: grep, backend: "grep" }
    return cachedCli
  }

  // Last resort: assume rg is in PATH
  cachedCli = { path: "rg", backend: "rg" }
  return cachedCli
}

export const DEFAULT_MAX_DEPTH = 20
export const DEFAULT_MAX_FILESIZE = "10M"
export const DEFAULT_MAX_COUNT = 500
export const DEFAULT_MAX_COLUMNS = 1000
export const DEFAULT_CONTEXT = 2
export const DEFAULT_TIMEOUT_MS = 300_000
export const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024

export const RG_SAFETY_FLAGS = [
  "--no-follow",
  "--color=never",
  "--no-heading",
  "--line-number",
  "--with-filename",
] as const

export const GREP_SAFETY_FLAGS = ["-n", "-H", "--color=never"] as const
