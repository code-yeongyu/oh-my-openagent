import { createRequire } from "module"
import { dirname, join } from "path"
import { existsSync, statSync } from "fs"
import { getCachedBinaryPath } from "./downloader"

type Platform = "darwin" | "linux" | "win32" | "unsupported"

function isValidBinary(filePath: string): boolean {
  try {
    return statSync(filePath).size > 10000
  } catch {
    return false
  }
}

function getPlatformPackageName(): string | null {
  const platform = process.platform as Platform
  const arch = process.arch

  const platformMap: Record<string, string> = {
    "darwin-arm64": "@ast-grep/cli-darwin-arm64",
    "darwin-x64": "@ast-grep/cli-darwin-x64",
    "linux-arm64": "@ast-grep/cli-linux-arm64-gnu",
    "linux-x64": "@ast-grep/cli-linux-x64-gnu",
    "win32-x64": "@ast-grep/cli-win32-x64-msvc",
    "win32-arm64": "@ast-grep/cli-win32-arm64-msvc",
    "win32-ia32": "@ast-grep/cli-win32-ia32-msvc",
  }

  return platformMap[`${platform}-${arch}`] ?? null
}

export function findSgCliPathSync(): string | null {
  const binaryName = process.platform === "win32" ? "sg.exe" : "sg"

  const cachedPath = getCachedBinaryPath()
  if (cachedPath && isValidBinary(cachedPath)) {
    return cachedPath
  }

  try {
    const require = createRequire(import.meta.url)
    const cliPkgPath = require.resolve("@ast-grep/cli/package.json")
    const cliDir = dirname(cliPkgPath)
    const sgPath = join(cliDir, binaryName)

    if (existsSync(sgPath) && isValidBinary(sgPath)) {
      return sgPath
    }
  } catch {
    // @ast-grep/cli not installed
  }

  const platformPkg = getPlatformPackageName()
  if (platformPkg) {
    try {
      const require = createRequire(import.meta.url)
      const pkgPath = require.resolve(`${platformPkg}/package.json`)
      const pkgDir = dirname(pkgPath)
      const astGrepName = process.platform === "win32" ? "ast-grep.exe" : "ast-grep"
      const binaryPath = join(pkgDir, astGrepName)

      if (existsSync(binaryPath) && isValidBinary(binaryPath)) {
        return binaryPath
      }
    } catch {
      // Platform-specific package not installed
    }
  }

  if (process.platform === "darwin") {
    const homebrewPaths = ["/opt/homebrew/bin/sg", "/usr/local/bin/sg"]
    for (const path of homebrewPaths) {
      if (existsSync(path) && isValidBinary(path)) {
        return path
      }
    }
  }

  return null
}

let resolvedCliPath: string | null = null

export function getSgCliPath(): string {
  if (resolvedCliPath !== null) {
    return resolvedCliPath
  }

  const syncPath = findSgCliPathSync()
  if (syncPath) {
    resolvedCliPath = syncPath
    return syncPath
  }

  return "sg"
}

export function setSgCliPath(path: string): void {
  resolvedCliPath = path
}

// CLI supported languages (25 total)
export const CLI_LANGUAGES = [
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "elixir",
  "go",
  "haskell",
  "html",
  "java",
  "javascript",
  "json",
  "kotlin",
  "lua",
  "nix",
  "php",
  "python",
  "ruby",
  "rust",
  "scala",
  "solidity",
  "swift",
  "typescript",
  "tsx",
  "yaml",
] as const

// NAPI supported languages (5 total - native bindings)
export const NAPI_LANGUAGES = ["html", "javascript", "tsx", "css", "typescript"] as const

// Language to file extensions mapping
export const DEFAULT_TIMEOUT_MS = 300_000
export const DEFAULT_MAX_OUTPUT_BYTES = 1 * 1024 * 1024
export const DEFAULT_MAX_MATCHES = 500

export const LANG_EXTENSIONS: Record<string, string[]> = {
  bash: [".bash", ".sh", ".zsh", ".bats"],
  c: [".c", ".h"],
  cpp: [".cpp", ".cc", ".cxx", ".hpp", ".hxx", ".h"],
  csharp: [".cs"],
  css: [".css"],
  elixir: [".ex", ".exs"],
  go: [".go"],
  haskell: [".hs", ".lhs"],
  html: [".html", ".htm"],
  java: [".java"],
  javascript: [".js", ".jsx", ".mjs", ".cjs"],
  json: [".json"],
  kotlin: [".kt", ".kts"],
  lua: [".lua"],
  nix: [".nix"],
  php: [".php"],
  python: [".py", ".pyi"],
  ruby: [".rb", ".rake"],
  rust: [".rs"],
  scala: [".scala", ".sc"],
  solidity: [".sol"],
  swift: [".swift"],
  typescript: [".ts", ".cts", ".mts"],
  tsx: [".tsx"],
  yaml: [".yml", ".yaml"],
}

export interface EnvironmentCheckResult {
  cli: {
    available: boolean
    path: string
    error?: string
  }
  napi: {
    available: boolean
    error?: string
  }
}

/**
 * Check if ast-grep CLI and NAPI are available.
 * Call this at startup to provide early feedback about missing dependencies.
 */
export function checkEnvironment(): EnvironmentCheckResult {
  const cliPath = getSgCliPath()
  const result: EnvironmentCheckResult = {
    cli: {
      available: false,
      path: cliPath,
    },
    napi: {
      available: false,
    },
  }

  if (existsSync(cliPath)) {
    result.cli.available = true
  } else if (cliPath === "sg") {
    try {
      const { spawnSync } = require("child_process")
      const whichResult = spawnSync(process.platform === "win32" ? "where" : "which", ["sg"], {
        encoding: "utf-8",
        timeout: 5000,
      })
      result.cli.available = whichResult.status === 0 && !!whichResult.stdout?.trim()
      if (!result.cli.available) {
        result.cli.error = "sg binary not found in PATH"
      }
    } catch {
      result.cli.error = "Failed to check sg availability"
    }
  } else {
    result.cli.error = `Binary not found: ${cliPath}`
  }

  // Check NAPI availability
  try {
    require("@ast-grep/napi")
    result.napi.available = true
  } catch (e) {
    result.napi.available = false
    result.napi.error = `@ast-grep/napi not installed: ${e instanceof Error ? e.message : String(e)}`
  }

  return result
}

/**
 * Format environment check result as user-friendly message.
 */
export function formatEnvironmentCheck(result: EnvironmentCheckResult): string {
  const lines: string[] = ["ast-grep Environment Status:", ""]

  // CLI status
  if (result.cli.available) {
    lines.push(`[OK] CLI: Available (${result.cli.path})`)
  } else {
    lines.push(`[X] CLI: Not available`)
    if (result.cli.error) {
      lines.push(`  Error: ${result.cli.error}`)
    }
    lines.push(`  Install: bun add -D @ast-grep/cli`)
  }

  // NAPI status
  if (result.napi.available) {
    lines.push(`[OK] NAPI: Available`)
  } else {
    lines.push(`[X] NAPI: Not available`)
    if (result.napi.error) {
      lines.push(`  Error: ${result.napi.error}`)
    }
    lines.push(`  Install: bun add -D @ast-grep/napi`)
  }

  lines.push("")
  lines.push(`CLI supports ${CLI_LANGUAGES.length} languages`)
  lines.push(`NAPI supports ${NAPI_LANGUAGES.length} languages: ${NAPI_LANGUAGES.join(", ")}`)

  return lines.join("\n")
}
