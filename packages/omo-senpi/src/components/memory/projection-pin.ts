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
  type ProjectedChanges,
} from "@oh-my-opencode/memory-core"

export const PROJECTION_PIN_ENTRY_TYPE = "omo-memory:projection-pin"
export const MEMORY_CHANGES_METADATA_TOKEN = "Memory changed after this session's prompt was pinned to"
const MAX_LISTED_PATHS = 20

export interface ProjectionPinRecord {
  readonly version: 1
  readonly sessionId: string
  readonly revision: string | null
  readonly noticedThrough: string | null
  readonly compactionId: string | null
  readonly pinnedAtMs: number
}

export type ProjectionRepinReason = "first-turn" | "compaction" | "refresh" | "missing-revision"

export interface ProjectionTurn {
  readonly revision: string | null
  readonly changes?: ProjectedChanges
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
  /** /recompile: every session repins to HEAD on its next turn, including ones resumed later in this process. */
  requestRefresh(): void
}

export function createProjectionPins(options: { readonly now?: () => number } = {}): ProjectionPins {
  const now = options.now ?? Date.now
  const live = new Map<string, { readonly record: ProjectionPinRecord; readonly epoch: number }>()
  let refreshEpoch = 0
  let refreshRequestedAtMs = Number.NEGATIVE_INFINITY

  return {
    requestRefresh(): void {
      refreshEpoch += 1
      refreshRequestedAtMs = now()
    },
    async advance({ repo, sessionId, branch, head, record }): Promise<ProjectionTurn> {
      const compactionId = latestCompactionId(branch)
      const cached = live.get(sessionId)
      const state = cached?.record ?? readPinRecord(branch, sessionId)
      const staleByRefresh = cached === undefined
        ? state !== undefined && state.pinnedAtMs < refreshRequestedAtMs
        : cached.epoch < refreshEpoch
      const reason = staleByRefresh ? "refresh" : await repinReason(repo, state, cached === undefined, compactionId)
      if (state === undefined || reason !== undefined) {
        const fresh: ProjectionPinRecord = {
          version: 1,
          sessionId,
          revision: head,
          noticedThrough: head,
          compactionId,
          pinnedAtMs: now(),
        }
        live.set(sessionId, { record: fresh, epoch: refreshEpoch })
        record(fresh)
        return { revision: head, repinned: reason ?? "first-turn" }
      }

      live.set(sessionId, { record: state, epoch: refreshEpoch })
      if (state.noticedThrough === head) return { revision: state.revision }
      const changes = await projectedChangesBetween(repo, state.noticedThrough, head, { excludeSessionId: sessionId })
      const advanced: ProjectionPinRecord = { ...state, noticedThrough: head }
      live.set(sessionId, { record: advanced, epoch: refreshEpoch })
      record(advanced)
      return isEmptyProjectedChanges(changes) ? { revision: state.revision } : { revision: state.revision, changes }
    },
  }
}

async function repinReason(
  repo: GitMemoryRepo,
  state: ProjectionPinRecord | undefined,
  loadedFromBranch: boolean,
  compactionId: string | null,
): Promise<ProjectionRepinReason | undefined> {
  if (state === undefined) return "first-turn"
  if (state.compactionId !== compactionId) return "compaction"
  if (!loadedFromBranch) return undefined
  for (const revision of [state.revision, state.noticedThrough]) {
    if (revision !== null && !(await revisionExists(repo, revision))) return "missing-revision"
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
  return { version: 1, sessionId: value.sessionId, revision, noticedThrough, compactionId, pinnedAtMs }
}

function latestCompactionId(branch: readonly unknown[]): string | null {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index]
    if (isRecord(entry) && entry.type === "compaction") return typeof entry.id === "string" ? entry.id : `index:${index}`
  }
  return null
}

export function renderProjectedChangesLine(changes: ProjectedChanges, pinnedRevision: string | null): string {
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
  return `- ${MEMORY_CHANGES_METADATA_TOKEN} ${pin}: ${parts.join("; ")}. The prompt keeps the pinned copy; read a file when it matters now.`
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
