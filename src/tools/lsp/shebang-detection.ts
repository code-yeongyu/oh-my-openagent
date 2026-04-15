import { readFileSync } from "fs"

export const SHEBANG_TO_LANG: Record<string, string> = {
  node: "javascript",
  "node.js": "javascript",
  bun: "javascript",
  deno: "typescript",
  python: "python",
  python3: "python",
  python2: "python",
  bash: "shellscript",
  sh: "shellscript",
  zsh: "shellscript",
  ksh: "shellscript",
  fish: "fish",
  ruby: "ruby",
  rake: "ruby",
  perl: "perl",
  php: "php",
  lua: "lua",
  lua5: "lua",
  "lua5.1": "lua",
  "lua5.2": "lua",
  "lua5.3": "lua",
  "lua5.4": "lua",
  go: "go",
  rust: "rust",
  cargo: "rust",
  tcl: "tcl",
  tclsh: "tcl",
  wish: "tcl",
  expect: "tcl",
  gawk: "awk",
  awk: "awk",
  sed: "sed",
}

const shebangCache = new Map<string, string | null>()
const MAX_CACHE_SIZE = 1000

export function parseShebang(shebangLine: string): string | null {
  const trimmed = shebangLine.trim()

  if (!trimmed.startsWith("#!")) {
    return null
  }

  let command = trimmed.slice(2).trim()

  if (command.includes("env ")) {
    const envMatch = command.match(/env\s+(?:-\S+\s+)*(\S+)/)
    if (envMatch) {
      command = envMatch[1]
    }
  }

  const parts = command.split("/")
  const interpreter = parts[parts.length - 1]

  const baseName = interpreter.replace(/\.\d+$/, "")

  return baseName || interpreter || null
}

export function detectShebangLanguage(filePath: string): string | null {
  const cached = shebangCache.get(filePath)
  if (cached !== undefined) {
    return cached
  }

  try {
    const buffer = readFileSync(filePath, { encoding: "utf-8", flag: "r" })
    const firstLine = buffer.split(/\r?\n/)[0]

    if (!firstLine || !firstLine.startsWith("#!")) {
      setCache(filePath, null)
      return null
    }

    const interpreter = parseShebang(firstLine)
    if (!interpreter) {
      setCache(filePath, null)
      return null
    }

    const lang = SHEBANG_TO_LANG[interpreter] || SHEBANG_TO_LANG[interpreter.toLowerCase()]

    setCache(filePath, lang || null)
    return lang || null
  } catch {
    setCache(filePath, null)
    return null
  }
}

function setCache(key: string, value: string | null): void {
  if (shebangCache.size >= MAX_CACHE_SIZE) {
    const entries = Array.from(shebangCache.entries())
    const half = Math.floor(entries.length / 2)
    shebangCache.clear()
    for (let i = half; i < entries.length; i++) {
      shebangCache.set(entries[i][0], entries[i][1])
    }
  }

  shebangCache.set(key, value)
}

export function clearShebangCache(): void {
  shebangCache.clear()
}

export function getShebangCacheSize(): number {
  return shebangCache.size
}
