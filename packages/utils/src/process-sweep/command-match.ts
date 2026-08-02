import { posix, win32 } from "node:path"

/**
 * Command-line matching primitives shared by sweep families. All matching is
 * token-aware: a path only counts when it appears as an executable token
 * (optionally preceded by a node/bun interpreter and runtime flags), never as
 * a data argument.
 */

export function splitCommandTokens(command: string): string[] {
  const tokens: string[] = []
  let current = ""
  let quote: string | null = null
  let tokenStarted = false
  for (const char of command) {
    if (quote !== null) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      tokenStarted = true
      continue
    }
    if (/\s/.test(char)) {
      if (tokenStarted || current.length > 0) {
        tokens.push(current)
        current = ""
        tokenStarted = false
      }
      continue
    }
    current += char
  }
  if (tokenStarted || current.length > 0) tokens.push(current)
  return tokens
}

export function hasExecutableToken(command: string, expectedPath: string): boolean {
  return splitCommandTokens(command).some(
    (token, index, tokens) => token === expectedPath && tokenAtIndexLooksExecutable(tokens, index),
  )
}

/**
 * Matches an executable token that ends with `suffix` and lives under `root`
 * (e.g. suffix `/lsp-daemon/dist/cli.js` matches both the bundled
 * `<root>/components/lsp-daemon/dist/cli.js` and the packaged
 * `<root>/node_modules/@code-yeongyu/lsp-daemon/dist/cli.js`).
 */
export function hasExecutableTokenUnderRootWithSuffix(command: string, root: string, suffix: string): boolean {
  return splitCommandTokens(command).some(
    (token, index, tokens) =>
      token.endsWith(suffix) && token.startsWith(`${root}/`) && tokenAtIndexLooksExecutable(tokens, index),
  )
}

function tokenAtIndexLooksExecutable(tokens: readonly string[], index: number): boolean {
  if (index === 0) return true
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const token = tokens[cursor]
    if (token === undefined || token.startsWith("-")) continue
    const executableName = token.split("/").at(-1) ?? token
    return /^node\d*(\.exe)?$/i.test(executableName) || /^bun(\.exe)?$/i.test(executableName)
  }
  return false
}

export function tokenLooksExecutable(command: string, tokenStart: number): boolean {
  let prefix = command.slice(0, tokenStart).trimEnd()
  if (prefix.length === 0) return true
  // Skip runtime flags between the executable and the script — the real 1.4.1
  // daemon runs as `<installDir>/node --liftoff-only <installDir>/lib/dist/bin/codegraph.js`.
  for (;;) {
    const previousTokenStart = findTokenStart(prefix, prefix.length - 1)
    const previousToken = prefix.slice(previousTokenStart)
    if (!previousToken.startsWith("-")) {
      const executableName = previousToken.split("/").at(-1) ?? previousToken
      return /^node\d*(\.exe)?$/i.test(executableName) || /^bun(\.exe)?$/i.test(executableName)
    }
    prefix = prefix.slice(0, previousTokenStart).trimEnd()
    if (prefix.length === 0) return false
  }
}

export function findTokenStart(command: string, index: number): number {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (/\s|["']/.test(command[cursor] ?? "")) return cursor + 1
  }
  return 0
}

export function findTokenEnd(command: string, index: number): number {
  for (let cursor = index; cursor < command.length; cursor += 1) {
    if (/\s|["']/.test(command[cursor] ?? "")) return cursor
  }
  return command.length
}

export function normalizeRoots(roots: readonly string[], platform: NodeJS.Platform): string[] {
  const normalized = new Set<string>()
  for (const root of roots) {
    const trimmed = root.trim()
    if (trimmed.length === 0) continue
    normalized.add(normalizeForComparison(resolvePathForPlatform(trimmed, platform), platform))
  }
  return [...normalized].sort((left, right) => right.length - left.length || left.localeCompare(right))
}

export function resolvePathForPlatform(value: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? win32.resolve(value) : posix.resolve(value)
}

export function normalizeForComparison(value: string, platform: NodeJS.Platform): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "")
  return platform === "win32" ? normalized.toLowerCase() : normalized
}
