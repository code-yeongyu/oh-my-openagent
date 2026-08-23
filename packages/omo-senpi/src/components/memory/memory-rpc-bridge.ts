import type { GitTreeSizedEntry } from "@oh-my-opencode/memory-core"

import type { SenpiExtensionAPI } from "../../extension/types"
import type { MemoryIdentityContext } from "./context"
import {
  buildMemorySnapshot,
  createMemoryRpcGitRepo,
  type MemoryTreeStats,
} from "./memory-rpc-snapshot-state"

/** Push channel: RPC clients receive `{type:"extension_event", name, data}` frames under this name. */
export const MEMORY_UPDATED_RPC_EVENT = "omo.memory.updated"
/** Pull channel: clients request the current snapshot with an `extension_request` for this method. */
export const MEMORY_STATUS_RPC_METHOD = "omo.memory.status"
export interface MemoryRpcGitRepo {
  head(): Promise<string | null>
  headCommitTimestamp(): Promise<number | null>
  headSubject(): Promise<string | null>
  status(paths?: readonly string[]): Promise<string>
  lsTree(revision?: string, path?: string): Promise<string[]>
  show(revision: string, path: string): Promise<string>
  /** Optional: whole-tree sizes. Absent on hosts/stubs that predate the size fields. */
  lsTreeSized?(revision?: string): Promise<readonly GitTreeSizedEntry[]>
  /** Optional: `git rev-list --count --since=<iso> HEAD`. */
  countCommitsSince?(sinceISO: string): Promise<number>
  /** Optional: newest commits, newest first, used for the previous entry timestamp. */
  recentCommits?(limit: number): Promise<readonly { readonly committedAt: string }[]>
}

export interface MemoryRpcActiveRun {
  readonly runId: string
  readonly trigger: string
  readonly category: string
  readonly model?: string
  readonly startedAt: string
}

export interface MemoryRpcLastOutcome {
  readonly runId: string
  readonly outcome: string
  readonly reason?: string
  readonly finishedAt: string
}

export interface MemoryRpcSnapshot {
  readonly schemaVersion: 1
  readonly identity: string
  readonly repo: {
    readonly headSha?: string
    readonly headSubject?: string
    readonly committedAtISO?: string
    readonly dirty: boolean
    readonly dirtyPaths: number
    readonly systemTokensEstimate: number
    /** Additive (post-v1): omitted whenever the underlying read is unavailable or fails. */
    readonly totalBytes?: number
    readonly systemBytes?: number
    readonly fileCount?: number
    readonly entriesToday?: number
    readonly previousEntryAtISO?: string
  }
  readonly reflection: {
    readonly backlogSteps: number
    readonly pendingCompaction: boolean
    readonly activeRun?: MemoryRpcActiveRun
    readonly lastOutcome?: MemoryRpcLastOutcome
    readonly consecutiveFailures: number
    readonly lastFailureFingerprint?: string
    /** Additive (post-v1): newest `merged` reflection completion, omitted when none exist. */
    readonly lastConsolidationAtISO?: string
  }
  readonly journal: {
    readonly sessionId: string
    readonly totalSteps: number
    readonly reflectedSteps: number
  }
}

export interface MemoryRpcUnavailable {
  readonly kind: "unavailable"
  readonly reason: string
}

export interface MemoryRpcBridgeDeps {
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  /** Lane E's active-run tracking: the run currently in flight for the identity, if any. */
  readonly activeRun: (identity: string) => MemoryRpcActiveRun | undefined
  readonly createGitRepo?: (repoPath: string) => MemoryRpcGitRepo
}

export interface MemoryRpcBridge {
  /** Binds the bridge to a session; a later attach replaces the binding and clears the dedupe. */
  attach(sessionId: string): void
  /** Publishes the current snapshot unless it is byte-identical to the last published one. */
  sync(): Promise<void>
  /** Unbinds the session so later syncs publish nothing. */
  detach(): void
  /** Retires the bridge; every later call is a no-op. */
  dispose(): void
}

/**
 * Publishes memory state to RPC clients: a fingerprint-deduped `omo.memory.updated` push plus an
 * `omo.memory.status` pull. Snapshots are RPC-only - they are never appended to the transcript -
 * and every rpc touch is guarded, so a host without `pi.rpc` degrades to a silent no-op.
 */
export function createMemoryRpcBridge(
  pi: SenpiExtensionAPI,
  deps: MemoryRpcBridgeDeps,
): MemoryRpcBridge {
  const createRepo = deps.createGitRepo ?? createMemoryRpcGitRepo
  const repos = new Map<string, MemoryRpcGitRepo>()
  /** Size reads walk the whole tree, so they are cached per commit, not per sync. */
  const tokenEstimates = new Map<string, number>()
  const treeStats = new Map<string, MemoryTreeStats>()
  let sessionId: string | undefined
  let lastSnapshot: string | undefined
  let disposed = false

  function repoFor(context: MemoryIdentityContext): MemoryRpcGitRepo {
    const cached = repos.get(context.identityPaths.repo)
    if (cached !== undefined) return cached
    const repo = createRepo(context.identityPaths.repo)
    repos.set(context.identityPaths.repo, repo)
    return repo
  }

  async function buildSnapshot(): Promise<MemoryRpcSnapshot | undefined> {
    const boundSession = sessionId
    if (disposed || boundSession === undefined) return undefined
    const context = deps.resolveContext(boundSession)
    if (context === undefined) return undefined
    return buildMemorySnapshot(context, boundSession, {
      repo: repoFor(context),
      activeRun: deps.activeRun,
      tokenEstimates,
      treeStats,
    })
  }

  registerStatusHandler(pi, buildSnapshot)

  return {
    attach(nextSessionId) {
      if (disposed) return
      sessionId = nextSessionId
      lastSnapshot = undefined
    },

    async sync() {
      if (disposed || pi.rpc?.emit === undefined) return
      const snapshot = await buildSnapshot()
      if (snapshot === undefined) return
      const fingerprint = JSON.stringify(snapshot)
      if (fingerprint === lastSnapshot) return
      lastSnapshot = fingerprint
      pi.rpc.emit(MEMORY_UPDATED_RPC_EVENT, snapshot)
    },

    detach() {
      sessionId = undefined
      lastSnapshot = undefined
    },

    dispose() {
      disposed = true
      sessionId = undefined
      lastSnapshot = undefined
    },
  }
}

function registerStatusHandler(
  pi: SenpiExtensionAPI,
  snapshot: () => Promise<MemoryRpcSnapshot | undefined>,
): void {
  const handle = pi.rpc?.handle
  if (handle === undefined) return
  handle(MEMORY_STATUS_RPC_METHOD, async (): Promise<MemoryRpcSnapshot | MemoryRpcUnavailable> => {
    const current = await snapshot()
    return current ?? { kind: "unavailable", reason: "No bound memory session." }
  })
}
