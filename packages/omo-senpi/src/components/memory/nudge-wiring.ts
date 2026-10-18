import type { EntryRenderer } from "@code-yeongyu/senpi"
import type { GitMemoryRepo, MemoryToolProvenance } from "@oh-my-opencode/memory-core"

import type { MemoryExtensionAPI } from "./capabilities"
import type { MemoryIdentityContext } from "./context"
import {
  MEMORY_TOOL_NAME,
} from "./tool-metadata"
import { joinFields, noticeComponent } from "./worker/entry-renderers"

export const ACCEPTED_TURNS_ENTRY_TYPE = "omo-memory:accepted-turns"

export interface AcceptedTurnsRecord {
  readonly version: 1
  readonly sessionId: string
  readonly priorUserTurns: number
  readonly sessionBaselineTurns: number
}

export interface ResolvedNudgeSettings {
  readonly enabled: boolean
  readonly everyUserTurns: number
}

export interface MemoryNudgeWiringOptions {
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  readonly resolveSettings: (identity: string) => ResolvedNudgeSettings
}

export interface MemoryNudgeWiring {
  register(pi: MemoryExtensionAPI): void
  nudgeTurns(repo: GitMemoryRepo, sessionId: string, identity: string): Promise<number | undefined>
  provenance(sessionId: string): MemoryToolProvenance | undefined
}

// House-notice renderer for the durable accepted-turns record. Not registered:
// the entry is appended on every accepted user turn (hydration bookkeeping),
// senpi hides unregistered custom entries, and createMemoryComponent's renderer
// list is pinned in index.test.ts (out of this change's scope).
export const renderAcceptedTurnsEntry: EntryRenderer<AcceptedTurnsRecord> = (entry, options, theme) => {
  const record = entry.data
  if (record === undefined) return undefined
  const turns = record.priorUserTurns
  const noun = turns === 1 ? "turn" : "turns"
  return noticeComponent(
    {
      glyph: "·",
      title: joinFields(["Memory accepted turns", `${turns} ${noun}`]),
      tone: "muted",
      why: `This session has recorded ${turns} accepted user ${noun}.`,
      extra: [{ text: `baseline ${record.sessionBaselineTurns}`, tone: "dim" }],
      detail: `session ${record.sessionId}`,
    },
    options,
    theme,
  )
}

// The check runs inside before_agent_start, so it holds the prompt: a slow git answer costs a nudge,
// never the turn.
const NUDGE_GIT_TIMEOUT_MS = 5_000
// Room for a save whose trailer fails the exact predicate below (a prefix collision in the grep).
const NUDGE_SCAN_LIMIT = 20
// A memory-tool commit cannot predate its session; the margin only absorbs clock adjustments.
const SESSION_START_MARGIN_MS = 60 * 60 * 1000

interface SaveScan {
  /** HEAD this scan covered, so the next check reads only the commits after it. */
  readonly head: string
  /** The turn of this session's newest memory-tool save at that HEAD, if it has saved. */
  readonly savedTurn: number | undefined
}

export function createMemoryNudgeWiring(options: MemoryNudgeWiringOptions): MemoryNudgeWiring {
  const sessions = new Map<string, AcceptedTurnsRecord>()
  const pendingInputs = new Map<string, string>()
  const sessionStarts = new Map<string, Date>()
  const scans = new Map<string, SaveScan>()

  /**
   * This session's newest memory-tool save, without walking the identity's whole history on every
   * prompt (#9667). The first check reads only commits since the session began and stops at the
   * first match; every later check reads only the commits after the HEAD it already covered.
   */
  async function latestSaveTurn(repo: GitMemoryRepo, sessionId: string, head: string): Promise<number | undefined> {
    const previous = scans.get(sessionId)
    if (previous?.head === head) return previous.savedTurn
    const since = sessionStarts.get(sessionId)
    const commits = await repo.log({
      grep: [`Omo-Writer: memory-tool`, `Omo-Session: ${sessionId}`],
      limit: NUDGE_SCAN_LIMIT,
      timeoutMs: NUDGE_GIT_TIMEOUT_MS,
      ...(previous !== undefined
        ? { range: `${previous.head}..${head}` }
        : since === undefined ? {} : { since: new Date(since.getTime() - SESSION_START_MARGIN_MS) }),
    })
    const save = commits.find((commit) =>
      commit.trailers["Omo-Writer"] === "memory-tool"
      && commit.trailers["Omo-Session"] === sessionId
      && parseTurn(commit.trailers["Omo-Turn"]) !== undefined
    )
    const savedTurn = save === undefined ? previous?.savedTurn : parseTurn(save.trailers["Omo-Turn"])
    scans.set(sessionId, { head, savedTurn })
    return savedTurn
  }

  function persist(pi: MemoryExtensionAPI, record: AcceptedTurnsRecord): void {
    sessions.set(record.sessionId, record)
    pi.appendEntry(ACCEPTED_TURNS_ENTRY_TYPE, record)
  }

  return {
    register(pi): void {
      pi.on("session_start", (_payload, eventCtx) => {
        const session = readSession(eventCtx)
        if (session === undefined) return
        sessionStarts.set(session.id, sessionStartedAt(eventCtx, session.entries) ?? new Date())
        scans.delete(session.id)
        const hydrated = findLatestAcceptedTurns(session.entries, session.id)
        if (hydrated !== undefined) {
          sessions.set(session.id, hydrated)
          return
        }
        sessions.set(session.id, {
          version: 1,
          sessionId: session.id,
          priorUserTurns: 0,
          sessionBaselineTurns: 0,
        })
      })

      pi.on("input", (payload, eventCtx) => {
        if (!isRecord(payload) || payload.type !== "input" || payload.source === "extension") return
        if (typeof payload.inputId !== "string" || payload.inputId.length === 0) return
        const sessionId = readSessionId(eventCtx)
        if (sessionId !== undefined) pendingInputs.set(payload.inputId, sessionId)
      })

      pi.on("input_disposition", (payload) => {
        if (!isRecord(payload) || payload.type !== "input_disposition") return
        if (typeof payload.inputId !== "string") return
        const sessionId = pendingInputs.get(payload.inputId)
        if (sessionId === undefined) return
        pendingInputs.delete(payload.inputId)
        if (payload.disposition !== "queued" && payload.disposition !== "started") return
        const current = sessions.get(sessionId) ?? {
          version: 1,
          sessionId,
          priorUserTurns: 0,
          sessionBaselineTurns: 0,
        }
        persist(pi, { ...current, priorUserTurns: current.priorUserTurns + 1 })
      })

      pi.on("tool_call", (payload, eventCtx) => {
        if (!isRecord(payload) || !isMemoryToolName(payload.toolName) || !isRecord(payload.input)) return
        const sessionId = readSessionId(eventCtx)
        if (sessionId === undefined) return
        const context = options.resolveContext(sessionId)
        const state = sessions.get(sessionId)
        if (context === undefined || state === undefined) return
        payload.input.provenance = {
          sessionId,
          userTurns: state.priorUserTurns,
          identityId: context.identity,
          repoPath: context.identityPaths.repo,
          // The receipt key for the IC-17 outbound half: unforgeable because the bridge
          // overwrites the whole provenance object; never read from model arguments.
          ...(typeof payload.toolCallId === "string" && payload.toolCallId.length > 0
            ? { toolCallId: payload.toolCallId }
            : {}),
        }
      })
    },

    async nudgeTurns(repo, sessionId, identity): Promise<number | undefined> {
      const state = sessions.get(sessionId)
      if (state === undefined) return undefined
      const settings = options.resolveSettings(identity)
      if (!settings.enabled) return undefined
      const head = await repo.head()
      const savedAt = (head === null ? undefined : await latestSaveTurn(repo, sessionId, head))
        ?? state.sessionBaselineTurns
      const pendingTurn = [...pendingInputs.values()].some((pendingSessionId) => pendingSessionId === sessionId) ? 1 : 0
      const turns = state.priorUserTurns + pendingTurn - savedAt
      return turns >= settings.everyUserTurns ? turns : undefined
    },

    provenance(sessionId): MemoryToolProvenance | undefined {
      const state = sessions.get(sessionId)
      return state === undefined ? undefined : { sessionId, userTurns: state.priorUserTurns }
    },
  }
}

function findLatestAcceptedTurns(
  entries: readonly unknown[],
  sessionId: string,
): AcceptedTurnsRecord | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (!isRecord(entry) || entry.type !== "custom" || entry.customType !== ACCEPTED_TURNS_ENTRY_TYPE) continue
    if (isAcceptedTurnsRecord(entry.data) && entry.data.sessionId === sessionId) return entry.data
  }
  return undefined
}

function isAcceptedTurnsRecord(value: unknown): value is AcceptedTurnsRecord {
  return isRecord(value)
    && value.version === 1
    && typeof value.sessionId === "string"
    && isTurn(value.priorUserTurns)
    && isTurn(value.sessionBaselineTurns)
    && value.sessionBaselineTurns <= value.priorUserTurns
}

function readSession(eventCtx: unknown): { id: string; entries: readonly unknown[] } | undefined {
  if (!isRecord(eventCtx) || !isRecord(eventCtx.sessionManager)) return undefined
  const manager = eventCtx.sessionManager
  const getSessionId = manager.getSessionId
  const getEntries = manager.getEntries
  if (typeof getSessionId !== "function" || typeof getEntries !== "function") return undefined
  const id = Reflect.apply(getSessionId, manager, [])
  const entries = Reflect.apply(getEntries, manager, [])
  return typeof id === "string" && id.length > 0 && Array.isArray(entries) ? { id, entries } : undefined
}

/** When the session began: its header, else its oldest entry. Undefined when neither carries a time. */
function sessionStartedAt(eventCtx: unknown, entries: readonly unknown[]): Date | undefined {
  const manager = isRecord(eventCtx) && isRecord(eventCtx.sessionManager) ? eventCtx.sessionManager : undefined
  const getHeader = manager?.getHeader
  const header = typeof getHeader === "function" ? Reflect.apply(getHeader, manager, []) : undefined
  const stamps = [isRecord(header) ? header.timestamp : undefined, ...entries.map((entry) => isRecord(entry) ? entry.timestamp : undefined)]
  let earliest: number | undefined
  for (const stamp of stamps) {
    const time = typeof stamp === "string" ? Date.parse(stamp) : typeof stamp === "number" ? stamp : Number.NaN
    if (Number.isFinite(time) && (earliest === undefined || time < earliest)) earliest = time
  }
  return earliest === undefined ? undefined : new Date(earliest)
}

function readSessionId(eventCtx: unknown): string | undefined {
  if (!isRecord(eventCtx) || !isRecord(eventCtx.sessionManager)) return undefined
  const manager = eventCtx.sessionManager
  const getter = manager.getSessionId
  if (typeof getter !== "function") return undefined
  const value = Reflect.apply(getter, manager, [])
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function parseTurn(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined
  const turn = Number(value)
  return isTurn(turn) ? turn : undefined
}

function isTurn(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isMemoryToolName(value: unknown): boolean {
  // The MCP surface exposes the same tools under senpi's catalog names (mcp_<server>_<tool>);
  // matching only the bare names would skip provenance injection on the search exposure.
  return value === MEMORY_TOOL_NAME
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
