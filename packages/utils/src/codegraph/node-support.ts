export const CODEGRAPH_MIN_NODE_MAJOR = 20
export const CODEGRAPH_BLOCKED_NODE_MAJOR = 25
export const CODEGRAPH_UNSAFE_NODE_ENV = "CODEGRAPH_ALLOW_UNSAFE_NODE"
export const CODEGRAPH_NODE_BIN_ENV = "CODEGRAPH_NODE_BIN"

export type CodegraphNodeUnsupportedReason = "too-new" | "too-old"

export interface CodegraphNodeSupport {
  readonly major: number
  readonly override: boolean
  readonly reason?: CodegraphNodeUnsupportedReason
  readonly supported: boolean
}

export interface EvaluateCodegraphNodeSupportOptions {
  readonly env?: Record<string, string | undefined> | undefined
  readonly nodeVersion?: string | undefined
}

export function evaluateCodegraphNodeSupport(
  options: EvaluateCodegraphNodeSupportOptions = {},
): CodegraphNodeSupport {
  const nodeVersion = options.nodeVersion ?? process.versions.node
  const env = options.env ?? process.env
  const override = (env[CODEGRAPH_UNSAFE_NODE_ENV]?.trim().length ?? 0) > 0
  const major = parseNodeMajor(nodeVersion)

  if (major >= CODEGRAPH_BLOCKED_NODE_MAJOR) {
    return { major, override, reason: "too-new", supported: override }
  }
  if (major < CODEGRAPH_MIN_NODE_MAJOR) {
    return { major, override, reason: "too-old", supported: override }
  }
  return { major, override, supported: true }
}

export function buildCodegraphNodeSkipHint(support: CodegraphNodeSupport): string {
  const detail =
    support.reason === "too-new"
      ? `Node ${support.major} is unsupported (>= ${CODEGRAPH_BLOCKED_NODE_MAJOR} crashes CodeGraph mid-indexing)`
      : `Node ${support.major} is too old (CodeGraph requires >= ${CODEGRAPH_MIN_NODE_MAJOR})`
  return `CodeGraph MCP skipped: ${detail}. Use Node ${CODEGRAPH_MIN_NODE_MAJOR}-${CODEGRAPH_BLOCKED_NODE_MAJOR - 1} (e.g. Node 22 LTS) or set ${CODEGRAPH_UNSAFE_NODE_ENV}=1 to override.\n`
}

function parseNodeMajor(version: string): number {
  const normalized = version.startsWith("v") ? version.slice(1) : version
  const major = Number.parseInt(normalized.split(".")[0] ?? "", 10)
  return Number.isNaN(major) ? 0 : major
}
