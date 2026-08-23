import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"

import {
  GitMemoryRepo,
  createNodeGitExec,
  type GitTreeSizedEntry,
} from "@oh-my-opencode/memory-core"

import type { MemoryIdentityContext } from "./context"
import type {
  MemoryRpcActiveRun,
  MemoryRpcGitRepo,
  MemoryRpcLastOutcome,
  MemoryRpcSnapshot,
} from "./memory-rpc-bridge"
import { MEMORY_HEALTH_SCAN_LIMIT } from "./status"
import { readReflectionHealth } from "./worker/health"

const GIT_QUERY_TIMEOUT_MS = 30_000

export interface MemorySnapshotDeps {
  readonly repo: MemoryRpcGitRepo
  readonly activeRun: (identity: string) => MemoryRpcActiveRun | undefined
  /** Per-HEAD system-token cache: the walk is per commit, not per sync. */
  readonly tokenEstimates: Map<string, number>
  /** Per-HEAD whole-tree size cache, sharing the token cache's commit-scoped lifetime. */
  readonly treeStats: Map<string, MemoryTreeStats>
}

/**
 * Assembles the RPC snapshot for one identity/session pair. `schemaVersion` stays 1 and every v1
 * field keeps its exact name and type: newer readers are additive and each one is best-effort, so a
 * failing git or filesystem probe omits its field rather than failing the whole snapshot.
 */
export async function buildMemorySnapshot(
  context: MemoryIdentityContext,
  sessionId: string,
  deps: MemorySnapshotDeps,
): Promise<MemoryRpcSnapshot> {
  const [repoState, journal, health, timeline, consolidation] = await Promise.all([
    readMemoryRpcRepoState(deps.repo, deps.tokenEstimates, deps.treeStats),
    readMemoryRpcJournalState(context, sessionId),
    readMemoryRpcHealth(context),
    readMemoryRpcTimeline(deps.repo),
    readLastConsolidationAt(context),
  ])
  const activeRun = deps.activeRun(context.identity)
  return {
    schemaVersion: 1,
    identity: context.identity,
    repo: { ...repoState, ...timeline },
    reflection: {
      backlogSteps: journal.backlogSteps,
      pendingCompaction: journal.pendingCompaction,
      ...(activeRun === undefined ? {} : { activeRun }),
      ...(health.lastOutcome === undefined ? {} : { lastOutcome: health.lastOutcome }),
      consecutiveFailures: health.streak,
      ...(health.fingerprint === undefined ? {} : { lastFailureFingerprint: health.fingerprint }),
      ...(consolidation === undefined ? {} : { lastConsolidationAtISO: consolidation }),
    },
    journal: {
      sessionId,
      totalSteps: journal.totalSteps,
      reflectedSteps: journal.reflectedSteps,
    },
  }
}

type TimelineState = Pick<MemoryRpcSnapshot["repo"], "entriesToday" | "previousEntryAtISO">

async function readMemoryRpcTimeline(repo: MemoryRpcGitRepo): Promise<TimelineState> {
  const [entriesToday, previousEntryAtISO] = await Promise.all([
    countEntriesToday(repo),
    readPreviousEntryAt(repo),
  ])
  return {
    ...(entriesToday === undefined ? {} : { entriesToday }),
    ...(previousEntryAtISO === undefined ? {} : { previousEntryAtISO }),
  }
}

/** Commits since LOCAL midnight - "today" is the user's day, not UTC's. */
async function countEntriesToday(repo: MemoryRpcGitRepo): Promise<number | undefined> {
  if (typeof repo.countCommitsSince !== "function") return undefined
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  try {
    const count = await repo.countCommitsSince(midnight.toISOString())
    return Number.isFinite(count) && count >= 0 ? Math.floor(count) : undefined
  } catch {
    return undefined
  }
}

async function readPreviousEntryAt(repo: MemoryRpcGitRepo): Promise<string | undefined> {
  if (typeof repo.recentCommits !== "function") return undefined
  try {
    const committedAt = (await repo.recentCommits(2))[1]?.committedAt
    return typeof committedAt === "string" && committedAt.length > 0 ? committedAt : undefined
  } catch {
    return undefined
  }
}

/** Newest `merged` reflection completion; the only outcome that changed committed memory. */
async function readLastConsolidationAt(
  context: MemoryIdentityContext,
): Promise<string | undefined> {
  const dir = join(context.identityPaths.reflection, "completions")
  let names: string[]
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".json"))
  } catch {
    return undefined
  }
  const finishedAts = await Promise.all(names.map((name) => mergedFinishedAt(join(dir, name))))
  let newest: string | undefined
  for (const finishedAt of finishedAts) {
    if (finishedAt === undefined) continue
    if (newest === undefined || Date.parse(finishedAt) > Date.parse(newest)) newest = finishedAt
  }
  return newest
}

async function mergedFinishedAt(path: string): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
    const record = parsed as Record<string, unknown>
    if (record.outcome !== "merged" || typeof record.finishedAt !== "string") return undefined
    return Number.isFinite(Date.parse(record.finishedAt)) ? record.finishedAt : undefined
  } catch {
    return undefined
  }
}

export async function readMemoryRpcRepoState(
  repo: MemoryRpcGitRepo,
  tokenEstimates: Map<string, number>,
  treeStats?: Map<string, MemoryTreeStats>,
): Promise<MemoryRpcSnapshot["repo"]> {
  const [head, dirtyPaths] = await Promise.all([repo.head(), readDirtyPaths(repo)])
  if (head === null) return { dirty: dirtyPaths > 0, dirtyPaths, systemTokensEstimate: 0 }
  const [committedAt, subject, stats] = await Promise.all([
    repo.headCommitTimestamp().catch(() => null),
    repo.headSubject().catch(() => null),
    readTreeStats(asTreeRepo(repo), head, treeStats),
  ])
  const systemTokensEstimate = stats === undefined
    ? tokenEstimates.get(head) ?? 0
    : Math.floor(stats.systemMarkdownBytes / 4)
  if (stats !== undefined) tokenEstimates.set(head, systemTokensEstimate)
  return {
    headSha: head,
    ...(subject === null ? {} : { headSubject: subject }),
    ...(committedAt === null ? {} : { committedAtISO: new Date(committedAt * 1_000).toISOString() }),
    dirty: dirtyPaths > 0,
    dirtyPaths,
    systemTokensEstimate,
    ...(stats === undefined
      ? {}
      : {
          totalBytes: stats.totalBytes,
          systemBytes: stats.systemBytes,
          fileCount: stats.fileCount,
        }),
  }
}

/**
 * One sized-tree walk per commit feeds both the token estimate and the size fields; a repeat sync
 * on the same HEAD reuses the cached stats, and a failed walk yields `undefined` so every derived
 * field is omitted rather than reported as a bogus zero.
 */
async function readTreeStats(
  repo: MemoryRpcTreeRepo,
  head: string,
  cache: Map<string, MemoryTreeStats> | undefined,
): Promise<MemoryTreeStats | undefined> {
  const cached = cache?.get(head)
  if (cached !== undefined) return cached
  try {
    const stats = memoryTreeStats(await repo.lsTreeSized(head))
    cache?.set(head, stats)
    return stats
  } catch {
    return undefined
  }
}

async function readDirtyPaths(repo: MemoryRpcGitRepo): Promise<number> {
  try {
    return (await repo.status()).split("\n").filter((line) => line.trim().length > 0).length
  } catch {
    return 0
  }
}

export interface MemoryRpcTreeRepo {
  lsTreeSized(revision?: string): Promise<readonly GitTreeSizedEntry[]>
}

export interface MemoryTreeStats {
  readonly totalBytes: number
  readonly fileCount: number
  readonly systemBytes: number
  /** `system/**\/*.md` only: the compiled-memory surface behind `systemTokensEstimate`. */
  readonly systemMarkdownBytes: number
  readonly byTopLevel: Record<string, number>
}

/** Walks `system/*.md` once per commit; a repeat sync on the same HEAD reuses the cached estimate. */
export async function estimateSystemTokens(
  repo: MemoryRpcTreeRepo,
  head: string,
  cache: Map<string, number>,
): Promise<number> {
  const cached = cache.get(head)
  if (cached !== undefined) return cached
  const stats = await readTreeStats(repo, head, undefined)
  if (stats === undefined) return 0
  const estimate = Math.floor(stats.systemMarkdownBytes / 4)
  cache.set(head, estimate)
  return estimate
}

export function memoryTreeStats(entries: readonly GitTreeSizedEntry[]): MemoryTreeStats {
  const byTopLevel: Record<string, number> = {}
  let totalBytes = 0
  let systemBytes = 0
  let systemMarkdownBytes = 0
  for (const entry of entries) {
    totalBytes += entry.bytes
    if (entry.path.startsWith("system/")) systemBytes += entry.bytes
    if (isSystemMarkdown(entry.path)) systemMarkdownBytes += entry.bytes
    const slash = entry.path.indexOf("/")
    const topLevel = slash === -1 ? entry.path : entry.path.slice(0, slash)
    byTopLevel[topLevel] = (byTopLevel[topLevel] ?? 0) + entry.bytes
  }
  return { totalBytes, fileCount: entries.length, systemBytes, systemMarkdownBytes, byTopLevel }
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

export async function readMemoryRpcJournalState(
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

export async function readMemoryRpcHealth(context: MemoryIdentityContext): Promise<HealthState> {
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

export function createMemoryRpcGitRepo(repoPath: string): MemoryRpcGitRepo & MemoryRpcTreeRepo {
  const repo = new GitMemoryRepo({ dir: repoPath, agentId: "omo-memory-rpc" })
  return {
    head: () => repo.head(),
    headCommitTimestamp: () => repo.headCommitTimestamp(),
    headSubject: async () => (await repo.log({ limit: 1 }))[0]?.subject ?? null,
    status: (paths) => repo.status(paths ?? []),
    lsTree: (revision, path) => repo.lsTree(revision, path),
    lsTreeSized: (revision) => repo.lsTreeSized(revision),
    show: (revision, path) => repo.show(revision, path),
    countCommitsSince: (sinceISO) => countCommitsSince(repoPath, sinceISO),
    recentCommits: (limit) => repo.log({ limit }),
  }
}

/**
 * `git rev-list --count --since=<iso> HEAD`. GitMemoryRepo exposes no rev-list surface and this is
 * the only caller, so the read runs through the same exec used by the repo class instead of
 * widening memory-core's API.
 */
async function countCommitsSince(repoPath: string, sinceISO: string): Promise<number> {
  const result = await createNodeGitExec().run(
    ["rev-list", "--count", `--since=${sinceISO}`, "HEAD"],
    { cwd: repoPath, timeoutMs: GIT_QUERY_TIMEOUT_MS },
  )
  if (result.code !== 0) throw new Error(`git rev-list failed: ${result.stderr.trim()}`)
  const count = Number.parseInt(result.stdout.trim(), 10)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("git rev-list returned no count")
  return count
}

function asTreeRepo(repo: MemoryRpcGitRepo): MemoryRpcTreeRepo {
  const lsTreeSized = (repo as Partial<MemoryRpcTreeRepo>).lsTreeSized
  if (typeof lsTreeSized !== "function") {
    return {
      lsTreeSized: async () => {
        throw new Error("lsTreeSized unavailable")
      },
    }
  }
  return { lsTreeSized: (revision) => lsTreeSized.call(repo, revision) }
}
