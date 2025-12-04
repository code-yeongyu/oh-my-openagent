import { createRequire } from "module"
import { dirname, join } from "path"
import { existsSync } from "fs"

type Platform = "darwin" | "linux" | "win32" | "unsupported"

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

function findSgCliPath(): string {
  // 1. Try to find from @ast-grep/cli package (installed via npm)
  try {
    const require = createRequire(import.meta.url)
    const cliPkgPath = require.resolve("@ast-grep/cli/package.json")
    const cliDir = dirname(cliPkgPath)
    const sgPath = join(cliDir, process.platform === "win32" ? "sg.exe" : "sg")

    if (existsSync(sgPath)) {
      return sgPath
    }
  } catch {
    // @ast-grep/cli not installed, try platform-specific package
  }

  // 2. Try platform-specific package directly
  const platformPkg = getPlatformPackageName()
  if (platformPkg) {
    try {
      const require = createRequire(import.meta.url)
      const pkgPath = require.resolve(`${platformPkg}/package.json`)
      const pkgDir = dirname(pkgPath)
      const binaryName = process.platform === "win32" ? "ast-grep.exe" : "ast-grep"
      const binaryPath = join(pkgDir, binaryName)

      if (existsSync(binaryPath)) {
        return binaryPath
      }
    } catch {
      // Platform-specific package not installed
    }
  }

  // 3. Fallback to system PATH
  return "sg"
}

// ast-grep CLI path (auto-detected from node_modules or system PATH)
export const SG_CLI_PATH = findSgCliPath()

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
