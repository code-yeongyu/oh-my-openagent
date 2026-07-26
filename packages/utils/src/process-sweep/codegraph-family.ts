import {
  hasExecutableToken,
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
const UPSTREAM_PACKAGE_SEGMENT = "/@colbymchenry/codegraph/"

export function selectZombieCodegraphProcesses(
  processes: readonly ProcessInfo[],
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
