import { hasExecutableTokenUnderRootWithSuffix, normalizeForComparison, normalizeRoots, splitCommandTokens } from "./command-match"
import { isOrphaned, type ProcessInfo } from "./process-table"

/**
 * lsp-daemon MCP proxy family.
 *
 * The codex plugin spawns one stdio proxy per session as
 * `<node|bun> <cliPath> mcp` where cliPath is either the bundled
 * `<pluginRoot>/components/lsp-daemon/dist/cli.js`, the packaged
 * `<pluginRoot>/node_modules/@code-yeongyu/lsp-daemon/dist/cli.js`, or the
 * dev shape `.../lsp-daemon/src/cli.ts`. When the parent session dies without
 * reaping the proxy (and the proxy's own watchdogs somehow missed it), the
 * orphan lingers forever — this family sweeps exactly those.
 *
 * The daemon SERVER shape (`cli.js daemon`, no `mcp` arg) is NEVER matched
 * here: it is a shared, deliberately detached process governed by the
 * stale-version family instead. Conservatism pin (#5902): a proxy whose
 * parent is still alive is spared unconditionally.
 */

export type LspDaemonProxyMatchKind = "lsp-daemon-proxy"

export interface LspDaemonProxyProcess extends ProcessInfo {
  readonly matchedRoot: string
  readonly matchKind: LspDaemonProxyMatchKind
}

export interface SelectOrphanedLspDaemonProxiesOptions {
  readonly ownedRoots: readonly string[]
  readonly platform?: NodeJS.Platform
}

const LSP_DAEMON_CLI_SUFFIXES = ["/lsp-daemon/dist/cli.js", "/lsp-daemon/src/cli.ts"] as const

export function selectOrphanedLspDaemonProxies(
  processes: readonly ProcessInfo[],
  options: SelectOrphanedLspDaemonProxiesOptions,
): LspDaemonProxyProcess[] {
  const platform = options.platform ?? process.platform
  const livePids = new Set(processes.map((processInfo) => processInfo.pid))
  const roots = normalizeRoots(options.ownedRoots, platform)
  const proxies: LspDaemonProxyProcess[] = []

  for (const processInfo of processes) {
    const matchedRoot = matchLspDaemonProxyCommand(processInfo.command, roots, platform)
    if (matchedRoot === null) continue
    if (!isOrphaned(processInfo, livePids)) continue
    proxies.push({ ...processInfo, matchedRoot, matchKind: "lsp-daemon-proxy" })
  }

  return proxies
}

function matchLspDaemonProxyCommand(
  command: string,
  roots: readonly string[],
  platform: NodeJS.Platform,
): string | null {
  const tokens = splitCommandTokens(command)
  // The proxy shape is `cli.js mcp`; the daemon server shape carries a
  // `daemon` token and must never match, even if a stray `mcp` appears.
  if (!tokens.includes("mcp") || tokens.includes("daemon")) return null
  const normalizedCommand = normalizeForComparison(command, platform)
  for (const root of roots) {
    if (root.length === 0) continue
    for (const suffix of LSP_DAEMON_CLI_SUFFIXES) {
      if (hasExecutableTokenUnderRootWithSuffix(normalizedCommand, root, suffix)) return root
    }
  }
  return null
}
