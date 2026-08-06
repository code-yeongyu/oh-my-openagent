import { hasExecutableTokenUnderRootWithSuffix, normalizeForComparison, normalizeRoots, splitCommandTokens } from "./command-match"
import { isOrphaned, type ProcessInfo } from "./process-table"

export interface GitBashProxyProcess extends ProcessInfo {
  readonly matchedRoot: string
  readonly matchKind: "git-bash-proxy"
}

export interface SelectOrphanedGitBashProxiesOptions {
  readonly ownedRoots: readonly string[]
  readonly platform?: NodeJS.Platform
}

const GIT_BASH_CLI_SUFFIX = "/git-bash-mcp/dist/cli.js"

export function selectOrphanedGitBashProxies(
  processes: readonly ProcessInfo[],
  options: SelectOrphanedGitBashProxiesOptions,
): GitBashProxyProcess[] {
  const platform = options.platform ?? process.platform
  const livePids = new Set(processes.map((processInfo) => processInfo.pid))
  const roots = normalizeRoots(options.ownedRoots, platform)

  return processes.flatMap((processInfo) => {
    const tokens = splitCommandTokens(processInfo.command)
    if (!tokens.includes("mcp") || !isOrphaned(processInfo, livePids)) return []
    const command = normalizeForComparison(processInfo.command, platform)
    const matchedRoot = roots.find((root) =>
      root.length > 0 && hasExecutableTokenUnderRootWithSuffix(command, root, GIT_BASH_CLI_SUFFIX))
    return matchedRoot === undefined ? [] : [{ ...processInfo, matchedRoot, matchKind: "git-bash-proxy" as const }]
  })
}
