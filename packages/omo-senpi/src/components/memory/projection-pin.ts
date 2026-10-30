// Session-pinned memory projection (#8470). A session compiles its memory block at the memory
// HEAD of its first turn and keeps those bytes: any later commit that reached the system prompt
// would change the prompt hash and cost a cache write of the whole conversation behind it. What
// changed after the pin reaches the model as a line of the late <memory_notice> message instead.
// The pin is a session entry, so a resume, a host restart or a runtime reload reproduces the same
// bytes. It moves only where the prompt cache is already cold or the user asked for it: after a
// compaction, on /recompile, or when a history rewrite took the pinned commit away.

import {
  isEmptyProjectedChanges,
  projectedChangesBetween,
  revisionExists,
  type GitMemoryRepo,
  type MemoryCommit,
  type ProjectedChanges,
} from "@oh-my-opencode/memory-core"

export { MEMORY_EXPIRED_METADATA_TOKEN } from "./projection-expiry"
export const PROJECTION_PIN_ENTRY_TYPE = "omo-memory:projection-pin"
export const MEMORY_CHANGES_METADATA_TOKEN = "Memory changed after this session's prompt was pinned to"
const MAX_LISTED_PATHS = 20
/** The trailer the sync engine writes on each sync commit: the principals whose batches it applied. */
const SYNC_PRINCIPALS_TRAILER = "Sync-Principals"
const UNKNOWN_DEVICE = "another device"

export interface ProjectionPinRecord {
  readonly version: 1
  readonly sessionId: string
  readonly revision: string | null
  readonly noticedThrough: string | null
  readonly compactionId: string | null
  readonly pinnedAtMs: number
  /** Expiry instants up to this one were announced; absent means none since the pin (#11450). */
  readonly expiryNoticedThroughMs?: number
}

export type ProjectionRepinReason = "first-turn" | "compaction" | "refresh" | "missing-revision"

export interface ProjectionTurn {
  readonly revision: string | null
  /** The instant `expires` is evaluated at for this turn's block: the pin instant. */
  readonly asOfMs: number
  /** Expiry instants after the pin and up to this one were already announced. */
  readonly expiryNoticedThroughMs: number
  readonly nowMs: number
  readonly changes?: ProjectedChanges
  /** Devices whose synced commits brought these changes, by name; absent when none were synced. */
  readonly sources?: readonly string[]
  readonly repinned?: ProjectionRepinReason
}

export interface ProjectionAdvanceInput {
  readonly repo: GitMemoryRepo
  readonly sessionId: string
  readonly branch: readonly unknown[]
  readonly head: string | null
  readonly record: (record: ProjectionPinRecord) => void
}

export interface ProjectionPins {
  advance(input: ProjectionAdvanceInput): Promise<ProjectionTurn>
  /**
   * The revision the next `advance` compiles at, without recording, caching or announcing anything:
   * a before_agent_start preview must compose the real turn's bytes and leave the session untouched.
   */
  peek(input: Omit<ProjectionAdvanceInput, "record">): Promise<{ readonly revision: string | null; readonly asOfMs: number }>
  /** Records that expiry instants up to `throughMs` were announced to the session. */
  noticeExpiries(input: { readonly sessionId: string; readonly throughMs: number; readonly record: (record: ProjectionPinRecord) => void }): void
  /** /recompile: every session repins to HEAD on its next turn, including ones resumed later in this process. */
  requestRefresh(): void
}

export interface ProjectionPinsOptions {
  readonly now?: () => number
  /** A principal's device name from this device's local device list; unknown principals read "another device". */
  readonly deviceName?: (principal: string) => string | undefined
}

export function createProjectionPins(options: ProjectionPinsOptions = {}): ProjectionPins {
  const now = options.now ?? Date.now
  const deviceName = options.deviceName ?? (() => undefined)
  const live = new Map<string, { readonly record: ProjectionPinRecord; readonly epoch: number }>()
  let refreshEpoch = 0
  let refreshRequestedAtMs = Number.NEGATIVE_INFINITY

  const resolve = async (repo: GitMemoryRepo, sessionId: string, branch: readonly unknown[], head: string | null) => {
    const compactionId = latestCompactionId(branch)
    const cached = live.get(sessionId)
    const state = cached?.record ?? readPinRecord(branch, sessionId)
    const staleByRefresh = cached === undefined
      ? state !== undefined && state.pinnedAtMs < refreshRequestedAtMs
      : cached.epoch < refreshEpoch
    const reason = staleByRefresh ? "refresh" : await repinReason(repo, state, cached === undefined, compactionId, head)
    return { compactionId, state, reason }
  }

  return {
    requestRefresh(): void {
      refreshEpoch += 1
      refreshRequestedAtMs = now()
    },
    async peek({ repo, sessionId, branch, head }) {
      const { state, reason } = await resolve(repo, sessionId, branch, head)
      return state === undefined || reason !== undefined
        ? { revision: head, asOfMs: now() }
        : { revision: state.revision, asOfMs: state.pinnedAtMs }
    },
    noticeExpiries({ sessionId, throughMs, record }): void {
      const cached = live.get(sessionId)
      if (cached === undefined) return
      const noticed: ProjectionPinRecord = { ...cached.record, expiryNoticedThroughMs: throughMs }
      live.set(sessionId, { record: noticed, epoch: cached.epoch })
      record(noticed)
    },
    async advance({ repo, sessionId, branch, head, record }): Promise<ProjectionTurn> {
      const { compactionId, state, reason } = await resolve(repo, sessionId, branch, head)
      const nowMs = now()
      if (state === undefined || reason !== undefined) {
        const fresh: ProjectionPinRecord = {
          version: 1,
          sessionId,
          revision: head,
          noticedThrough: head,
          compactionId,
          pinnedAtMs: nowMs,
        }
        live.set(sessionId, { record: fresh, epoch: refreshEpoch })
        record(fresh)
        return { revision: head, asOfMs: nowMs, expiryNoticedThroughMs: nowMs, nowMs, repinned: reason ?? "first-turn" }
      }

      live.set(sessionId, { record: state, epoch: refreshEpoch })
      const pinned = {
        revision: state.revision,
        asOfMs: state.pinnedAtMs,
        expiryNoticedThroughMs: state.expiryNoticedThroughMs ?? state.pinnedAtMs,
        nowMs,
      }
      if (state.noticedThrough === head) return pinned
      let rangeCommits: readonly MemoryCommit[] = []
      const changes = await projectedChangesBetween(repo, state.noticedThrough, head, {
        excludeSessionId: sessionId,
        onCommits: (commits) => {
          rangeCommits = commits
        },
      })
      const advanced: ProjectionPinRecord = { ...state, noticedThrough: head }
      live.set(sessionId, { record: advanced, epoch: refreshEpoch })
      record(advanced)
      if (isEmptyProjectedChanges(changes)) return pinned
      const sources = syncedSources(rangeCommits, changes, deviceName)
      return sources.length === 0 ? { ...pinned, changes } : { ...pinned, changes, sources }
    },
  }
}

/** The paths the notice line actually shows (the first MAX_LISTED_PATHS, in group order). */
function shownPaths(changes: ProjectedChanges): Set<string> {
  return new Set([...changes.added, ...changes.updated, ...changes.removed].slice(0, MAX_LISTED_PATHS))
}

/** A device name as it may appear in the prompt: one line, no control characters, bounded. */
function promptSafeName(name: string): string | undefined {
  const clean = name.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 64)
  return clean.length === 0 ? undefined : clean
}

/** Device names behind the sync commits in the range (read once, by the change scan) that touched a shown path. */
function syncedSources(
  commits: readonly MemoryCommit[],
  changes: ProjectedChanges,
  deviceName: (principal: string) => string | undefined,
): string[] {
  const listed = shownPaths(changes)
  const names = new Set<string>()
  for (const commit of commits) {
    const principals = commit.trailers[SYNC_PRINCIPALS_TRAILER]
    if (principals === undefined || !(commit.paths ?? []).some((path) => listed.has(path))) continue
    for (const principal of principals.split(",").map((p) => p.trim()).filter((p) => p.length > 0)) {
      const known = deviceName(principal)
      names.add((known === undefined ? undefined : promptSafeName(known)) ?? UNKNOWN_DEVICE)
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

async function repinReason(
  repo: GitMemoryRepo,
  state: ProjectionPinRecord | undefined,
  loadedFromBranch: boolean,
  compactionId: string | null,
  head: string | null,
): Promise<ProjectionRepinReason | undefined> {
  if (state === undefined) return "first-turn"
  if (state.compactionId !== compactionId) return "compaction"
  if (!loadedFromBranch) return undefined
  // HEAD was just read, so a pinned revision equal to it exists; only an older one needs the object lookup.
  for (const revision of new Set([state.revision, state.noticedThrough])) {
    if (revision !== null && revision !== head && !(await revisionExists(repo, revision))) return "missing-revision"
  }
  return undefined
}

/** The newest record this session wrote; a fork's copied records name the parent session and are skipped. */
function readPinRecord(branch: readonly unknown[], sessionId: string): ProjectionPinRecord | undefined {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index]
    if (!isRecord(entry) || entry.type !== "custom" || entry.customType !== PROJECTION_PIN_ENTRY_TYPE) continue
    const record = parsePinRecord(entry.data)
    if (record?.sessionId === sessionId) return record
  }
  return undefined
}

function parsePinRecord(value: unknown): ProjectionPinRecord | undefined {
  if (!isRecord(value) || value.version !== 1 || typeof value.sessionId !== "string") return undefined
  const { revision, noticedThrough, compactionId, pinnedAtMs } = value
  if (!isNullableString(revision) || !isNullableString(noticedThrough) || !isNullableString(compactionId)) return undefined
  if (typeof pinnedAtMs !== "number" || !Number.isFinite(pinnedAtMs)) return undefined
  const record = { version: 1 as const, sessionId: value.sessionId, revision, noticedThrough, compactionId, pinnedAtMs }
  const noticed = value.expiryNoticedThroughMs
  return typeof noticed === "number" && Number.isFinite(noticed) ? { ...record, expiryNoticedThroughMs: noticed } : record
}

function latestCompactionId(branch: readonly unknown[]): string | null {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index]
    if (isRecord(entry) && entry.type === "compaction") return typeof entry.id === "string" ? entry.id : `index:${index}`
  }
  return null
}

export function renderProjectedChangesLine(
  changes: ProjectedChanges,
  pinnedRevision: string | null,
  sources: readonly string[] = [],
): string {
  const groups = [
    ["added", changes.added],
    ["updated", changes.updated],
    ["removed", changes.removed],
  ] as const
  let budget = MAX_LISTED_PATHS
  const parts: string[] = []
  for (const [verb, paths] of groups) {
    if (paths.length === 0) continue
    const shown = paths.slice(0, Math.max(0, budget))
    budget -= shown.length
    const hidden = paths.length - shown.length
    const listed = [...shown, ...(hidden > 0 ? [`${hidden} more`] : [])]
    parts.push(`${verb} ${listed.join(", ")}`)
  }
  const pin = pinnedRevision === null ? "an empty memory repo" : pinnedRevision.slice(0, 7)
  const synced = sources.length === 0 ? "" : `, synced from ${sources.join(", ")}`
  return `- ${MEMORY_CHANGES_METADATA_TOKEN} ${pin}: ${parts.join("; ")}${synced}. The prompt keeps the pinned copy; read a file when it matters now.`
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
