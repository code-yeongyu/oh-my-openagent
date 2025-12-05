import { existsSync, statSync } from "fs"
import { getCachedBinaryPath } from "./downloader"

function isValidBinary(filePath: string): boolean {
  try {
    return statSync(filePath).size > 10000
  } catch {
    return false
  }
}

export function findSgCliPathSync(): string | null {
  const cachedPath = getCachedBinaryPath()
  if (cachedPath && isValidBinary(cachedPath)) {
    return cachedPath
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

export const SG_CLI_PATH = getSgCliPath()

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
  const result: EnvironmentCheckResult = {
    cli: {
      available: false,
      path: SG_CLI_PATH,
    },
    napi: {
      available: false,
    },
  }

  // Check CLI availability
  if (existsSync(SG_CLI_PATH)) {
    result.cli.available = true
  } else if (SG_CLI_PATH === "sg") {
    // Fallback path - try which/where to find in PATH
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
    result.cli.error = `Binary not found: ${SG_CLI_PATH}`
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
    lines.push(`✓ CLI: Available (${result.cli.path})`)
  } else {
    lines.push(`✗ CLI: Not available`)
    if (result.cli.error) {
      lines.push(`  Error: ${result.cli.error}`)
    }
    lines.push(`  Install: bun add -D @ast-grep/cli`)
  }

  // NAPI status
  if (result.napi.available) {
    lines.push(`✓ NAPI: Available`)
  } else {
    lines.push(`✗ NAPI: Not available`)
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
