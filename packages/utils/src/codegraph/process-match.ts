import { posix, win32 } from "node:path"

export type CodegraphProcessMatchKind = "serve-wrapper" | "upstream-codegraph"

export interface CodegraphProcessInfo {
  readonly command: string
  readonly pid: number
  readonly ppid: number
}

export interface CodegraphZombieProcess extends CodegraphProcessInfo {
  readonly matchedRoot: string
  readonly matchKind: CodegraphProcessMatchKind
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
    const match = matchOwnedCodegraphCommand(processInfo.command, roots, platform)
    if (match === null) continue
    if (!isOrphaned(processInfo, livePids)) continue
    zombies.push({ ...processInfo, matchedRoot: match.root, matchKind: match.kind })
  }

  return zombies
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
  const prefix = command.slice(0, tokenStart).trimEnd()
  if (prefix.length === 0) return true
  const previousTokenStart = findTokenStart(prefix, prefix.length - 1)
  const previousToken = prefix.slice(previousTokenStart)
  const executableName = previousToken.split("/").at(-1) ?? previousToken
  return /^node\d*(\.exe)?$/.test(executableName) || /^bun(\.exe)?$/.test(executableName)
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
