import { isCanonicalEntry, projectTranscriptEntries, type GitTreeSizedEntry, type TranscriptProjection } from "@oh-my-opencode/memory-core"

import type { SenpiExtensionAPI } from "../../extension/types"
import type { MemoryIdentityContext } from "./context"
import { MEMORY_FACTS_APPLY_RPC_METHOD, type MemoryFactsApplier } from "./facts-apply-rpc"
import { readMemoryRpcJournalState } from "./memory-rpc-journal-state"
import { MEMORY_REFLECTIONS_RPC_METHOD, readMemoryReflections } from "./memory-rpc-reflections"
import type { MemoryRpcSync } from "./memory-rpc-sync"
import type { SyncStatusReader } from "./sync-status-surface"
export { MEMORY_REFLECTIONS_RPC_METHOD } from "./memory-rpc-reflections"
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
  /** Initial journal-only delivery: non-journal defaults are unknown, not measured zeroes. */
  readonly nonJournalState?: "unknown"
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
    /** Completed answers observed in the session or its durable journal; not a journal fsync fence. */
    readonly totalSteps: number
    readonly reflectedSteps: number
  }
  /** Additive (#10637): this device's memory sync state; omitted while the device does not sync this memory. */
  readonly sync?: MemoryRpcSync
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
  /** `omo.memory.facts.apply`: the facts extractor's apply for the bound session; absent registers nothing. */
  readonly applyFacts?: MemoryFactsApplier
  /** The repository's sync status for the snapshot's `sync` field; absent omits the field. */
  readonly syncStatus?: SyncStatusReader
}

export interface MemoryRpcBridge {
  /** Binds the bridge to a session; a later attach replaces the binding and clears the dedupe. */
  attach(sessionId: string): void
  /** Full builds remain FIFO; completed results enter publication behind already admitted journal requests. */
  sync(signal?: AbortSignal): Promise<void>
  /** Publishes in journal-request order, without waiting for full builds, git or the journal writer lock. */
  syncJournal(entries: readonly TranscriptProjection[]): Promise<void>
  /** Unbinds the session so later syncs publish nothing. */
  detach(): void
  /** Retires the bridge; every later call is a no-op. */
  dispose(): void
}

interface MemoryPublication {
  readonly snapshot: MemoryRpcSnapshot
  readonly force?: boolean
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
  let lastPublished: MemoryRpcSnapshot | undefined
  let disposed = false
  let bindingGeneration = 0
  let publication = Promise.resolve()
  let fullBuilds = Promise.resolve()
  let journalRevision = 0
  let observedSteps = new Set<string>()

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
      observedSteps,
      ...(deps.syncStatus === undefined ? {} : { syncStatus: deps.syncStatus }),
    })
  }

  // The settle-time delivery is awaited by the host with no budget, so it refreshes only the
  // journal fields from local files; repo, health and sync fields come from the last full build.
  async function buildJournalSnapshot(): Promise<MemoryPublication | undefined> {
    const boundSession = sessionId
    if (boundSession === undefined || disposed) return undefined
    const context = deps.resolveContext(boundSession)
    if (context === undefined) return undefined
    const previous: MemoryRpcSnapshot = lastPublished ?? {
      schemaVersion: 1,
      identity: context.identity,
      nonJournalState: "unknown",
      repo: { dirty: false, dirtyPaths: 0, systemTokensEstimate: 0 },
      reflection: { backlogSteps: 0, pendingCompaction: false, consecutiveFailures: 0 },
      journal: { sessionId: boundSession, totalSteps: 0, reflectedSteps: 0 },
    }
    const journal = await readMemoryRpcJournalState(context, boundSession, observedSteps)
    return {
      snapshot: {
        ...previous,
        reflection: { ...previous.reflection, backlogSteps: journal.backlogSteps, pendingCompaction: journal.pendingCompaction },
        journal: { ...previous.journal, totalSteps: journal.totalSteps, reflectedSteps: journal.reflectedSteps },
      },
      force: journal.transcriptReadFailed === true,
    }
  }

  registerStatusHandler(pi, buildSnapshot)
  pi.rpc?.handle?.(MEMORY_REFLECTIONS_RPC_METHOD, async (request) => {
    const boundSession = sessionId
    const generation = bindingGeneration
    const context = boundSession === undefined ? undefined : deps.resolveContext(boundSession)
    if (disposed || boundSession === undefined || context === undefined) {
      return { kind: "unavailable", reason: "No bound memory session." }
    }
    const page = await readMemoryReflections(context, boundSession, request)
    if (disposed || generation !== bindingGeneration || context !== deps.resolveContext(boundSession)) {
      return { kind: "unavailable", reason: "Memory session binding changed." }
    }
    return page
  })

  const applyFacts = deps.applyFacts
  if (applyFacts !== undefined) {
    pi.rpc?.handle?.(MEMORY_FACTS_APPLY_RPC_METHOD, async (request) => {
      if (disposed || sessionId === undefined) return { kind: "unavailable", reason: "No bound memory session." }
      const applied = await applyFacts(request, sessionId)
      if ("outcome" in applied && applied.outcome === "committed") await syncFullSnapshot()
      return applied
    })
  }

  function publishSnapshot(
    build: () => Promise<MemoryPublication | undefined>,
    generation: number,
    signal?: AbortSignal,
    journalOnly = false,
  ): Promise<void> {
    const current = publication.then(async () => {
      if (disposed || signal?.aborted || generation !== bindingGeneration || pi.rpc?.emit === undefined) return
      const built = await build()
      if (built === undefined || signal?.aborted || disposed || generation !== bindingGeneration) return
      const { snapshot } = built
      if (journalOnly) journalRevision++
      const fingerprint = JSON.stringify(snapshot)
      if (fingerprint === lastSnapshot && !built.force) return
      lastSnapshot = fingerprint
      lastPublished = snapshot
      pi.rpc.emit(MEMORY_UPDATED_RPC_EVENT, snapshot)
    })
    // Keep failures visible to their caller without poisoning the next publication.
    publication = current.catch(() => {})
    return current
  }

  function syncFullSnapshot(signal?: AbortSignal): Promise<void> {
    const generation = bindingGeneration
    const current = fullBuilds.then(async () => {
      if (disposed || signal?.aborted || generation !== bindingGeneration || pi.rpc?.emit === undefined) return
      const revision = journalRevision
      const snapshot = await buildSnapshot()
      if (snapshot === undefined) return
      // Full work never occupies publication. A result joins only when ready; any journal
      // delivery that overtook its build remains authoritative for the journal fields.
      await publishSnapshot(async () => {
        if (revision === journalRevision || lastPublished === undefined) return { snapshot }
        return {
          snapshot: {
            ...snapshot,
            reflection: {
              ...snapshot.reflection,
              backlogSteps: lastPublished.reflection.backlogSteps,
              pendingCompaction: lastPublished.reflection.pendingCompaction,
            },
            journal: lastPublished.journal,
          },
        }
      }, generation, signal)
    })
    fullBuilds = current.catch(() => {})
    return current
  }

  return {
    attach(nextSessionId) {
      if (disposed) return
      sessionId = nextSessionId
      bindingGeneration++
      lastSnapshot = undefined
      lastPublished = undefined
      publication = Promise.resolve()
      fullBuilds = Promise.resolve()
      journalRevision = 0
      observedSteps = new Set()
    },

    sync: syncFullSnapshot,

    syncJournal(entries) {
      if (disposed || sessionId === undefined) return Promise.resolve()
      for (const entry of entries.flatMap((message) => projectTranscriptEntries(message, ""))) {
        if (entry.kind === "assistant" && isCanonicalEntry(entry)) observedSteps.add(entry.source_line_id)
      }
      return publishSnapshot(buildJournalSnapshot, bindingGeneration, undefined, true)
    },

    detach() {
      bindingGeneration++
      sessionId = undefined
      lastSnapshot = undefined
      lastPublished = undefined
      publication = Promise.resolve()
      fullBuilds = Promise.resolve()
      journalRevision = 0
      observedSteps = new Set()
    },

    dispose() {
      bindingGeneration++
      disposed = true
      sessionId = undefined
      lastSnapshot = undefined
      lastPublished = undefined
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
