import {
  hasExecutableToken,
  hasExecutableTokenUnderRootWithSuffix,
  normalizeForComparison,
  normalizeRoots,
  splitCommandTokens,
  tokenLooksExecutable,
  findTokenStart,
} from "./command-match"
import { isOrphaned, type CodegraphProcessInfo, type ProcessInfo } from "./process-table"

export type CodegraphProcessMatchKind = "serve-wrapper" | "upstream-codegraph" | "upstream-daemon"

export type { CodegraphProcessInfo }

export interface CodegraphZombieProcess extends ProcessInfo {
  readonly matchedRoot: string
  readonly matchKind: CodegraphProcessMatchKind
  readonly daemonProjectRoot?: string
}

export interface SelectZombieCodegraphProcessesOptions {
  readonly ownedRoots: readonly string[]
  readonly platform?: NodeJS.Platform
}

const SERVE_WRAPPER_SUFFIX = "/components/codegraph/dist/serve.js"
const UPSTREAM_PACKAGE_PATTERN = /\/@colbymchenry\/codegraph(?:-(?:darwin|linux|win32)-(?:arm64|x64))?\//g

export function selectZombieCodegraphProcesses(
  processes: readonly ProcessInfo[],
  options: SelectZombieCodegraphProcessesOptions,
): CodegraphZombieProcess[] {
  const platform = options.platform ?? process.platform
  const livePids = new Set(processes.map((processInfo) => processInfo.pid))
  const processByPid = new Map(processes.map((processInfo) => [processInfo.pid, processInfo]))
  const roots = normalizeRoots(options.ownedRoots, platform)
  const daemonMatches = new Map<number, { readonly projectRoot: string; readonly root: string }>()
  const workerMatches = new Map<number, { readonly kind: CodegraphProcessMatchKind; readonly root: string }>()
  const ancestry = { livePids, processByPid, workerMatches }
  const zombies: CodegraphZombieProcess[] = []

  for (const processInfo of processes) {
    const daemon = matchDaemonCommand(processInfo.command, roots, platform)
    if (daemon !== null) {
      daemonMatches.set(processInfo.pid, daemon)
      continue
    }
    const worker = matchOwnedCodegraphCommand(processInfo.command, roots, platform)
    if (worker !== null) workerMatches.set(processInfo.pid, worker)
  }

  for (const processInfo of processes) {
    const daemon = daemonMatches.get(processInfo.pid)
    if (daemon !== undefined) {
      if (!isOrphaned(processInfo, livePids)) continue
      zombies.push({
        ...processInfo,
        daemonProjectRoot: daemon.projectRoot,
        matchedRoot: daemon.root,
        matchKind: "upstream-daemon",
      })
      continue
    }
    const worker = workerMatches.get(processInfo.pid)
    if (worker === undefined) continue
    if (!isOrphaned(processInfo, livePids) && !hasOrphanedWorkerAncestor(processInfo, ancestry)) continue
    zombies.push({ ...processInfo, matchedRoot: worker.root, matchKind: worker.kind })
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
    if (hasExecutableTokenUnderRootWithSuffix(normalizedCommand, root, BUNDLE_SCRIPT_SUFFIX)) return { projectRoot, root }
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
    if (hasExecutableTokenUnderRootWithSuffix(normalizedCommand, root, BUNDLE_SCRIPT_SUFFIX)
      || hasExecutableToken(normalizedCommand, `${root}/npm-shim.js`)
      || upstreamPackagePathIsUnderRoot(normalizedCommand, root)) {
      return { kind: "upstream-codegraph", root }
    }
  }
  return null
}

function upstreamPackagePathIsUnderRoot(command: string, root: string): boolean {
  UPSTREAM_PACKAGE_PATTERN.lastIndex = 0
  for (;;) {
    const match = UPSTREAM_PACKAGE_PATTERN.exec(command)
    if (match === null) return false
    const tokenStart = findTokenStart(command, match.index)
    if (command.slice(tokenStart).startsWith(`${root}/`) && tokenLooksExecutable(command, tokenStart)) return true
  }
}

function hasOrphanedWorkerAncestor(
  processInfo: ProcessInfo,
  ancestry: {
    readonly livePids: ReadonlySet<number>
    readonly processByPid: ReadonlyMap<number, ProcessInfo>
    readonly workerMatches: ReadonlyMap<number, { readonly kind: CodegraphProcessMatchKind; readonly root: string }>
  },
): boolean {
  const visited = new Set<number>()
  let parentPid = processInfo.ppid
  for (;;) {
    if (visited.has(parentPid)) return false
    visited.add(parentPid)
    const parent = ancestry.processByPid.get(parentPid)
    if (parent === undefined || !ancestry.workerMatches.has(parent.pid)) return false
    if (isOrphaned(parent, ancestry.livePids)) return true
    parentPid = parent.ppid
  }
}
