import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { GitMemoryRepo } from "@oh-my-opencode/memory-core"

import type { SenpiExtensionAPI } from "../../extension/types"
import type { MemoryIdentityContext } from "./context"
import { MEMORY_HEALTH_SCAN_LIMIT } from "./status"
import { readReflectionHealth } from "./worker/health"

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
  }
  readonly reflection: {
    readonly backlogSteps: number
    readonly pendingCompaction: boolean
    readonly activeRun?: MemoryRpcActiveRun
    readonly lastOutcome?: MemoryRpcLastOutcome
    readonly consecutiveFailures: number
    readonly lastFailureFingerprint?: string
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
  const createRepo = deps.createGitRepo ?? defaultGitRepo
  const repos = new Map<string, MemoryRpcGitRepo>()
  /** Token estimates walk the whole system tree, so they are cached per commit, not per sync. */
  const tokenEstimates = new Map<string, number>()
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
    const repo = repoFor(context)
    const [repoState, journal, health] = await Promise.all([
      readRepoState(repo, tokenEstimates),
      readJournalState(context, boundSession),
      readHealth(context),
    ])
    const activeRun = deps.activeRun(context.identity)
    return {
      schemaVersion: 1,
      identity: context.identity,
      repo: repoState,
      reflection: {
        backlogSteps: journal.backlogSteps,
        pendingCompaction: journal.pendingCompaction,
        ...(activeRun === undefined ? {} : { activeRun }),
        ...(health.lastOutcome === undefined ? {} : { lastOutcome: health.lastOutcome }),
        consecutiveFailures: health.streak,
        ...(health.fingerprint === undefined ? {} : { lastFailureFingerprint: health.fingerprint }),
      },
      journal: {
        sessionId: boundSession,
        totalSteps: journal.totalSteps,
        reflectedSteps: journal.reflectedSteps,
      },
    }
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

async function readRepoState(
  repo: MemoryRpcGitRepo,
  tokenEstimates: Map<string, number>,
): Promise<MemoryRpcSnapshot["repo"]> {
  const [head, dirtyPaths] = await Promise.all([repo.head(), readDirtyPaths(repo)])
  if (head === null) return { dirty: dirtyPaths > 0, dirtyPaths, systemTokensEstimate: 0 }
  const [committedAt, subject, systemTokensEstimate] = await Promise.all([
    repo.headCommitTimestamp().catch(() => null),
    repo.headSubject().catch(() => null),
    estimateSystemTokens(repo, head, tokenEstimates),
  ])
  return {
    headSha: head,
    ...(subject === null ? {} : { headSubject: subject }),
    ...(committedAt === null ? {} : { committedAtISO: new Date(committedAt * 1_000).toISOString() }),
    dirty: dirtyPaths > 0,
    dirtyPaths,
    systemTokensEstimate,
  }
}

async function readDirtyPaths(repo: MemoryRpcGitRepo): Promise<number> {
  try {
    return (await repo.status()).split("\n").filter((line) => line.trim().length > 0).length
  } catch {
    return 0
  }
}

/** Walks `system/*.md` once per commit; a repeat sync on the same HEAD reuses the cached estimate. */
async function estimateSystemTokens(
  repo: MemoryRpcGitRepo,
  head: string,
  cache: Map<string, number>,
): Promise<number> {
  const cached = cache.get(head)
  if (cached !== undefined) return cached
  try {
    const paths = (await repo.lsTree(head)).filter(isSystemMarkdown)
    const contents = await Promise.all(paths.map((path) => repo.show(head, path)))
    const totalBytes = contents.reduce((sum, content) => sum + Buffer.byteLength(content, "utf8"), 0)
    const estimate = Math.floor(totalBytes / 4)
    cache.set(head, estimate)
    return estimate
  } catch {
    return 0
  }
}

function isSystemMarkdown(path: string): boolean {
  return path.startsWith("system/") && path.endsWith(".md")
}

interface JournalState {
  readonly backlogSteps: number
  readonly pendingCompaction: boolean
  readonly totalSteps: number
  readonly reflectedSteps: number
}

async function readJournalState(
  context: MemoryIdentityContext,
  sessionId: string,
): Promise<JournalState> {
  const empty: JournalState = {
    backlogSteps: 0,
    pendingCompaction: context.ledger.pendingCompaction,
    totalSteps: 0,
    reflectedSteps: 0,
  }
  try {
    const raw: unknown = JSON.parse(
      await readFile(join(context.identityPaths.transcripts, sessionId, "state.json"), "utf8"),
    )
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return empty
    const state = raw as Record<string, unknown>
    return {
      backlogSteps: countOf(state.steps_since_last_successful_reflection),
      pendingCompaction: state.pending_compaction === true || context.ledger.pendingCompaction,
      totalSteps: countOf(state.total_completed_steps),
      reflectedSteps: countOf(state.reflected_completed_steps),
    }
  } catch {
    return empty
  }
}

function countOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

interface HealthState {
  readonly streak: number
  readonly fingerprint?: string
  readonly lastOutcome?: MemoryRpcLastOutcome
}

async function readHealth(context: MemoryIdentityContext): Promise<HealthState> {
  try {
    const health = await readReflectionHealth(
      join(context.identityPaths.reflection, "completions"),
      { limit: MEMORY_HEALTH_SCAN_LIMIT },
    )
    const last = health.lastOutcome
    return {
      streak: health.streak,
      ...(health.fingerprint.length === 0 ? {} : { fingerprint: health.fingerprint }),
      ...(last === undefined
        ? {}
        : {
            lastOutcome: {
              runId: last.runId,
              outcome: last.outcome,
              ...(last.reason === undefined ? {} : { reason: last.reason }),
              finishedAt: last.finishedAt,
            },
          }),
    }
  } catch {
    return { streak: 0 }
  }
}

function defaultGitRepo(repoPath: string): MemoryRpcGitRepo {
  const repo = new GitMemoryRepo({ dir: repoPath, agentId: "omo-memory-rpc" })
  return {
    head: () => repo.head(),
    headCommitTimestamp: () => repo.headCommitTimestamp(),
    headSubject: async () => (await repo.log({ limit: 1 }))[0]?.subject ?? null,
    status: (paths) => repo.status(paths ?? []),
    lsTree: (revision, path) => repo.lsTree(revision, path),
    show: (revision, path) => repo.show(revision, path),
  }
}
