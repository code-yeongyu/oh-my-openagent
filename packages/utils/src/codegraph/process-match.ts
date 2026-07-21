import { posix, win32 } from "node:path"

export type CodegraphProcessMatchKind = "serve-wrapper" | "upstream-codegraph" | "upstream-daemon"

export interface CodegraphProcessInfo {
  readonly command: string
  readonly pid: number
  readonly ppid: number
}

export interface CodegraphZombieProcess extends CodegraphProcessInfo {
  readonly matchedRoot: string
  readonly matchKind: CodegraphProcessMatchKind
  readonly daemonProjectRoot?: string
}

export interface SelectZombieCodegraphProcessesOptions {
  readonly ownedRoots: readonly string[]
  readonly platform?: NodeJS.Platform
}

const SERVE_WRAPPER_SUFFIX = "/components/codegraph/dist/serve.js"
const UPSTREAM_PACKAGE_SEGMENT = "/@colbymchenry/codegraph/"

export function parsePosixProcessTable(output: string): CodegraphProcessInfo[] {
  const processes: CodegraphProcessInfo[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line)
    if (match === null) continue
    const pid = Number(match[1])
    const ppid = Number(match[2])
    const command = match[3]
    if (!isValidProcessId(pid) || !Number.isInteger(ppid) || ppid < 0 || command === undefined) continue
    processes.push({ command, pid, ppid })
  }
  return processes
}

export function parseWindowsProcessTable(output: string): CodegraphProcessInfo[] {
  const parsed = parseJson(output)
  const entries = Array.isArray(parsed) ? parsed : parsed === undefined ? [] : [parsed]
  const processes: CodegraphProcessInfo[] = []
  for (const entry of entries) {
    if (!isRecord(entry)) continue
    const pid = numberField(entry, "ProcessId")
    const ppid = numberField(entry, "ParentProcessId")
    const command = stringField(entry, "CommandLine")
    if (pid === undefined || ppid === undefined || command === undefined || command.trim().length === 0) continue
    processes.push({ command, pid, ppid })
  }
  return processes
}

export function selectZombieCodegraphProcesses(
  processes: readonly CodegraphProcessInfo[],
  options: SelectZombieCodegraphProcessesOptions,
): CodegraphZombieProcess[] {
  const platform = options.platform ?? process.platform
  const livePids = new Set(processes.map((processInfo) => processInfo.pid))
  const roots = normalizeRoots(options.ownedRoots, platform)
  const zombies: CodegraphZombieProcess[] = []

  for (const processInfo of processes) {
    const daemon = matchDaemonCommand(processInfo.command, roots, platform)
    if (daemon !== null) {
      if (!isOrphaned(processInfo, livePids)) continue
      zombies.push({
        ...processInfo,
        daemonProjectRoot: daemon.projectRoot,
        matchedRoot: daemon.root,
        matchKind: "upstream-daemon",
      })
      continue
    }
    const match = matchOwnedCodegraphCommand(processInfo.command, roots, platform)
    if (match === null) continue
    if (!isOrphaned(processInfo, livePids)) continue
    zombies.push({ ...processInfo, matchedRoot: match.root, matchKind: match.kind })
  }

  return zombies
}

const STANDALONE_LAUNCHER_SUFFIXES = ["/bin/codegraph", "/bin/codegraph.exe"] as const
const BUNDLE_SCRIPT_SUFFIX = "/lib/dist/bin/codegraph.js"

/**
 * Daemon shape (verified against the real 1.4.1 binary): an owned upstream
 * codegraph binary invoked as `serve --mcp --path <root>`. Upstream spawns it
 * DETACHED (ppid 1 by design), so the plain orphan rule must not condemn it —
 * the sweeper's lockfile staleness gate decides instead. Shapes seen in the
 * wild: the provisioned launcher `<installDir>/bin/codegraph`, the post-exec
 * bundle `<installDir>/node --liftoff-only <installDir>/lib/dist/bin/codegraph.js`,
 * and the npm package `node .../@colbymchenry/codegraph/bin/codegraph.js`.
 */
function matchDaemonCommand(
  command: string,
  roots: readonly string[],
  platform: NodeJS.Platform,
): { readonly projectRoot: string; readonly root: string } | null {
  const projectRoot = extractDaemonProjectRoot(splitCommandTokens(command))
  if (projectRoot === null) return null
  const normalizedCommand = normalizeForComparison(command, platform)
  for (const root of roots) {
    if (root.length === 0) continue
    if (upstreamPackagePathIsUnderRoot(normalizedCommand, root)) return { projectRoot, root }
    for (const suffix of STANDALONE_LAUNCHER_SUFFIXES) {
      if (hasExecutableToken(normalizedCommand, `${root}${suffix}`)) return { projectRoot, root }
    }
    if (hasExecutableToken(normalizedCommand, `${root}${BUNDLE_SCRIPT_SUFFIX}`)) return { projectRoot, root }
  }
  return null
}

function extractDaemonProjectRoot(tokens: readonly string[]): string | null {
  if (!tokens.includes("serve") || !tokens.includes("--mcp")) return null
  const pathIndex = tokens.indexOf("--path")
  if (pathIndex < 0) return null
  const value = tokens[pathIndex + 1]
  if (value === undefined || value.length === 0 || value.startsWith("--")) return null
  return value
}

function splitCommandTokens(command: string): string[] {
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

function matchOwnedCodegraphCommand(
  command: string,
  roots: readonly string[],
  platform: NodeJS.Platform,
): { readonly kind: CodegraphProcessMatchKind; readonly root: string } | null {
  const normalizedCommand = normalizeForComparison(command, platform)
  for (const root of roots) {
    if (root.length === 0) continue
    const serveWrapper = `${root}${SERVE_WRAPPER_SUFFIX}`
    if (hasExecutableToken(normalizedCommand, serveWrapper)) return { kind: "serve-wrapper", root }
    if (upstreamPackagePathIsUnderRoot(normalizedCommand, root)) {
      return { kind: "upstream-codegraph", root }
    }
  }
  return null
}

function hasExecutableToken(command: string, expectedPath: string): boolean {
  let searchFrom = 0
  for (;;) {
    const pathIndex = command.indexOf(expectedPath, searchFrom)
    if (pathIndex < 0) return false
    const tokenStart = findTokenStart(command, pathIndex)
    const tokenEnd = findTokenEnd(command, pathIndex + expectedPath.length)
    if (command.slice(tokenStart, tokenEnd) === expectedPath && tokenLooksExecutable(command, tokenStart)) return true
    searchFrom = pathIndex + expectedPath.length
  }
}

function tokenLooksExecutable(command: string, tokenStart: number): boolean {
  let prefix = command.slice(0, tokenStart).trimEnd()
  if (prefix.length === 0) return true
  // Skip runtime flags between the executable and the script — the real 1.4.1
  // daemon runs as `<installDir>/node --liftoff-only <installDir>/lib/dist/bin/codegraph.js`.
  for (;;) {
    const previousTokenStart = findTokenStart(prefix, prefix.length - 1)
    const previousToken = prefix.slice(previousTokenStart)
    if (!previousToken.startsWith("-")) {
      const executableName = previousToken.split("/").at(-1) ?? previousToken
      return /^node\d*(\.exe)?$/.test(executableName) || /^bun(\.exe)?$/.test(executableName)
    }
    prefix = prefix.slice(0, previousTokenStart).trimEnd()
    if (prefix.length === 0) return false
  }
}

function upstreamPackagePathIsUnderRoot(command: string, root: string): boolean {
  let searchFrom = 0
  for (;;) {
    const packageIndex = command.indexOf(UPSTREAM_PACKAGE_SEGMENT, searchFrom)
    if (packageIndex < 0) return false
    const tokenStart = findTokenStart(command, packageIndex)
    if (command.slice(tokenStart).startsWith(`${root}/`) && tokenLooksExecutable(command, tokenStart)) return true
    searchFrom = packageIndex + UPSTREAM_PACKAGE_SEGMENT.length
  }
}

function findTokenStart(command: string, index: number): number {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (/\s|["']/.test(command[cursor] ?? "")) return cursor + 1
  }
  return 0
}

function findTokenEnd(command: string, index: number): number {
  for (let cursor = index; cursor < command.length; cursor += 1) {
    if (/\s|["']/.test(command[cursor] ?? "")) return cursor
  }
  return command.length
}

function normalizeRoots(roots: readonly string[], platform: NodeJS.Platform): string[] {
  const normalized = new Set<string>()
  for (const root of roots) {
    const trimmed = root.trim()
    if (trimmed.length === 0) continue
    normalized.add(normalizeForComparison(resolvePathForPlatform(trimmed, platform), platform))
  }
  return [...normalized].sort((left, right) => right.length - left.length || left.localeCompare(right))
}

function resolvePathForPlatform(value: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? win32.resolve(value) : posix.resolve(value)
}

function normalizeForComparison(value: string, platform: NodeJS.Platform): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "")
  return platform === "win32" ? normalized.toLowerCase() : normalized
}

function isOrphaned(processInfo: CodegraphProcessInfo, livePids: ReadonlySet<number>): boolean {
  return processInfo.ppid === 1 || !livePids.has(processInfo.ppid)
}

function isValidProcessId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === "number" && isValidProcessId(value) ? value : undefined
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
