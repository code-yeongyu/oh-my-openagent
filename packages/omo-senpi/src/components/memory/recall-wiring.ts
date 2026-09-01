// Memorian recall wiring (plan .omo/plans/memorian-m3-gate.md todo 1).
//
// Recall owns its OWN before_agent_start handler, NOT an extra field on the memory prompt
// handler's result: senpi's ExtensionRunner.emitBeforeAgentStart pushes every handler's
// `result.message` into a combined `messages[]` array, so two handlers of the same extension each
// contribute one message. That separation is the invariant that keeps recall away from
// systemPrompt.
//
// The lexical auto-injection path is GONE: nothing is injected from a plain corpus match. Candidate
// collection now runs at SETTLE time (the turn is complete there, so the current-prompt seam
// disappears) and feeds the memorian gate child, whose validated nudges are what a later turn
// injects. before_agent_start is the delivery half: it only drains the pending file the gate wrote.
// Every step stays fail-open: an unreadable memory repo or a corrupt corpus drops the collection
// and logs, and the turn proceeds untouched.

import type { OmoMemorySettings } from "@oh-my-opencode/omo-config-core"
import {
  GitMemoryRepo,
  PendingNudges,
  RecallCorpusCache,
  RecallLedger,
  planRecallQueries,
  renderNudgeBlock,
  selectRecallCandidates,
  type RecallCandidate,
  type RecallNudge,
} from "@oh-my-opencode/memory-core"

import type { ComponentLogger } from "../../extension/types"
import type { MemoryExtensionAPI } from "./capabilities"
import type { MemoryIdentityContext } from "./context"
import { MEMORY_NOTICE_CUSTOM_TYPE } from "./prompt"
import { renderRecallEntry, type MemoryRecallRecord } from "./recall-notice"
import { resolveMemorySettings } from "./identity-runtime"

export interface ResolvedMemoryRecallSettings {
  readonly enabled: boolean
  readonly max_items: number
}

/** Base recall block under the bound agent's layer override, mirroring the nudge/reflection pattern. */
export function resolveAgentRecallSettings(
  settings: OmoMemorySettings | undefined,
  agentId: string,
): ResolvedMemoryRecallSettings {
  const resolved = resolveMemorySettings(settings)
  return { ...resolved.recall, ...resolved.agents[agentId]?.recall }
}

export const RECALL_CUSTOM_TYPE = "omo-memorian:recall"

/** Newest conversation texts feeding the query planner; older turns are not what the user is on. */
const RECALL_TEXT_WINDOW = 6

// Memory-owned hidden channels. Their content is derived FROM memory, so feeding them back into
// the query planner would make recall search for the hint it just injected.
const EXCLUDED_CUSTOM_TYPES: ReadonlySet<string> = new Set([RECALL_CUSTOM_TYPE, MEMORY_NOTICE_CUSTOM_TYPE])

export interface MemoryRecallWiringOptions {
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  /** Full memory settings; the bound agent's recall override is applied internally. */
  readonly resolveSettings: () => OmoMemorySettings
  readonly env: Record<string, string | undefined>
  readonly createRepo?: (context: MemoryIdentityContext) => GitMemoryRepo
  readonly corpusCache?: RecallCorpusCache
  readonly ledgerFor?: (context: MemoryIdentityContext) => RecallLedger
  readonly pendingFor?: (context: MemoryIdentityContext) => PendingNudgesPort
  /**
   * The session's live compaction epoch, owned by the memorian gate wiring. A pending payload is
   * stamped with the epoch its judge ran under, so passing the live one here is what rejects a
   * verdict about a transcript a compaction has since rewritten. Absent means "never compacted",
   * matching the gate wiring's own default for an unknown session.
   */
  readonly currentCompactionEpoch?: (sessionId: string) => number
  readonly logger?: ComponentLogger
}

/** The pending handoff the gate writes and this turn drains; `take` is read-and-delete. */
export interface PendingNudgesPort {
  take(sessionId: string, options: { readonly currentEpoch: number }): Promise<RecallNudge[]>
}

/** One line of the judge's transcript window: both roles, oldest first. */
export interface RecallTranscriptTurn {
  readonly role: "user" | "assistant"
  readonly text: string
}

/** Everything the memorian gate child needs about one settled turn's lexical candidates. */
export interface CollectedRecallCandidates {
  readonly sessionId: string
  readonly context: MemoryIdentityContext
  readonly candidates: readonly RecallCandidate[]
  /** Already-surfaced paths: the persona sees them, the parent validator re-checks them. */
  readonly surfaced: ReadonlySet<string>
  /** Authoritative cap (memory.recall.max_items) resolved for the bound agent. */
  readonly maxItems: number
  /**
   * The judge's window. USER+ASSISTANT, unlike the planner's user-only input: matching keys on
   * user intent, but judging needs to see what the agent already said to avoid nudging a fact the
   * turn has covered.
   */
  readonly transcript: readonly RecallTranscriptTurn[]
}

/**
 * The ctx-derived half of a settle, read synchronously while the ctx is still alive. The memorian
 * gate detaches its launch, and the host disposes the ctx as soon as the settle handler returns, so
 * the gate captures this first and the async work consumes only these plain values.
 */
export interface RecallSessionSnapshot {
  readonly id: string
  readonly entries: readonly unknown[]
}

export interface MemoryRecallWiring {
  register(pi: MemoryExtensionAPI): void
  /** Settle-time seam: lexical candidates for the completed turn, or undefined when there are none. */
  collectCandidates(eventCtx: unknown): Promise<CollectedRecallCandidates | undefined>
  /**
   * Synchronous ctx read for detached callers. Returns undefined when the ctx carries no usable
   * session; never throws, so a disposed ctx degrades to "no candidates" instead of a failed turn.
   */
  snapshotSession(eventCtx: unknown): RecallSessionSnapshot | undefined
  /** Collection over an already-captured snapshot; touches no ctx at all. */
  collectCandidatesFromSnapshot(snapshot: RecallSessionSnapshot): Promise<CollectedRecallCandidates | undefined>
}

// A memory worker child must never receive recall hints: it reasons ABOUT memory, and an injected
// hint would both pollute its transcript and re-enter memory on the next extraction pass. The
// memorian sentinel is here for the sharper reason: a gate child that received nudges would judge
// the hints it exists to produce, and would spawn a gate over its own transcript.
const CHILD_SENTINELS = ["SENPI_MEMORY_REFLECTION", "SENPI_MEMORY_FACTS", "SENPI_MEMORY_MEMORIAN"] as const

/**
 * Provenance recorded next to a surfaced path. The ledger keys on the path alone - the hash exists
 * so a reader can tell a gate-delivered hint from a lexically matched one.
 */
const GATE_SURFACE_HASH = "memorian-gate"

export function createMemoryRecallWiring(options: MemoryRecallWiringOptions): MemoryRecallWiring {
  const corpusCache = options.corpusCache ?? new RecallCorpusCache()
  const createRepo = options.createRepo ?? defaultCreateRepo
  const ledgerFor = options.ledgerFor ?? ((context) => new RecallLedger(context.identityPaths.recallLedger))
  const pendingFor = options.pendingFor ?? ((context) => new PendingNudges(context.identityPaths.recallPending))

  async function collect(eventCtx: unknown): Promise<CollectedRecallCandidates | undefined> {
    if (CHILD_SENTINELS.some((sentinel) => options.env[sentinel] === "1")) return undefined
    // agent_settled carries no session fields, so the session is read from the event context the
    // same way the before_agent_start handler reads it.
    const session = readSession(eventCtx)
    if (session === undefined) return undefined
    return await collectFrom(session)
  }

  /** The ctx-free remainder of collection: everything below runs off plain captured values. */
  async function collectFrom(session: RecallSession): Promise<CollectedRecallCandidates | undefined> {
    if (CHILD_SENTINELS.some((sentinel) => options.env[sentinel] === "1")) return undefined
    const context = options.resolveContext(session.id)
    if (context === undefined) return undefined

    const recall = resolveAgentRecallSettings(options.resolveSettings(), context.identity)
    if (recall.enabled === false) return undefined

    // USER-role texts only: candidates are keyed on user intent, and assistant prose (which often
    // paraphrases memory back at the user) would skew matching.
    const texts = userTexts(session.entries)
    if (texts.length === 0) return undefined
    const queries = planRecallQueries(texts)
    if (queries.length === 0) return undefined

    const repo = createRepo(context)
    const corpus = await corpusCache.load(repo)
    if (corpus.documents.length === 0) return undefined

    const ledger = ledgerFor(context)
    const surfaced = await ledger.surfacedPaths(session.id)
    const candidates = selectRecallCandidates(corpus.documents, queries, {
      maxItems: recall.max_items,
      surfaced,
    })
    if (candidates.length === 0) return undefined
    return {
      sessionId: session.id,
      context,
      candidates,
      surfaced,
      maxItems: recall.max_items,
      transcript: judgeTranscript(session.entries),
    }
  }

  /** Drain the gate's pending nudges for this turn. Returns undefined when there is nothing to say. */
  async function inject(payload: unknown, eventCtx: unknown): Promise<RecallInjection | undefined> {
    if (!isBeforeAgentStart(payload)) return undefined
    if (CHILD_SENTINELS.some((sentinel) => options.env[sentinel] === "1")) return undefined
    const session = readSession(eventCtx)
    if (session === undefined) return undefined
    const context = options.resolveContext(session.id)
    if (context === undefined) return undefined
    if (resolveAgentRecallSettings(options.resolveSettings(), context.identity).enabled === false) return undefined

    const nudges = await pendingFor(context).take(session.id, {
      currentEpoch: options.currentCompactionEpoch?.(session.id) ?? 0,
    })
    if (nudges.length === 0) return undefined

    // Composed BEFORE any bookkeeping: marking is advisory, so its failure must never consume or
    // suppress a nudge the judge already paid for.
    const injection: RecallInjection = {
      result: {
        message: {
          customType: RECALL_CUSTOM_TYPE,
          content: nudges.map(renderNudgeBlock).join("\n"),
          display: false,
        },
      },
      paths: nudges.map((nudge) => nudge.path),
    }

    try {
      await ledgerFor(context).markSurfaced(
        session.id,
        nudges.map((nudge) => ({ path: nudge.path, hash: GATE_SURFACE_HASH })),
      )
    } catch (error) {
      // Fail-open: an unrecorded path simply stays eligible for a later gate run.
      options.logger?.warn("omo-senpi memory recall ledger mark skipped", {
        sessionId: session.id,
        error: describe(error),
      })
    }
    return injection
  }

  return {
    register(pi): void {
      pi.registerEntryRenderer(RECALL_CUSTOM_TYPE, renderRecallEntry)
      pi.on("before_agent_start", async (payload, eventCtx) => {
        try {
          const injection = await inject(payload, eventCtx)
          if (injection === undefined) return undefined
          try {
            // Visible half: the model-facing message is display:false, so without this entry the
            // user would see a memory-shaped answer with no trace of where it came from.
            pi.appendEntry(RECALL_CUSTOM_TYPE, { paths: injection.paths } satisfies MemoryRecallRecord)
          } catch (error) {
            // Fail-open: the visible trace is bookkeeping - its failure must never suppress a
            // nudge the ledger already recorded as delivered.
            options.logger?.warn("omo-senpi memory recall trace entry skipped", { error: describe(error) })
          }
          return injection.result
        } catch (error) {
          // Read-only advice: any failure skips the injection and leaves the turn untouched.
          options.logger?.warn("omo-senpi memory recall skipped", { error: describe(error) })
          return undefined
        }
      })
    },
    async collectCandidates(eventCtx): Promise<CollectedRecallCandidates | undefined> {
      try {
        return await collect(eventCtx)
      } catch (error) {
        // Read-only advice: any failure drops the collection and leaves the turn untouched.
        options.logger?.warn("omo-senpi memory recall candidate collection skipped", { error: describe(error) })
        return undefined
      }
    },
    snapshotSession(eventCtx): RecallSessionSnapshot | undefined {
      try {
        return readSession(eventCtx)
      } catch (error) {
        // A disposed ctx throws on every property read; that is a silent skip, not a turn failure.
        options.logger?.warn("omo-senpi memory recall session snapshot skipped", { error: describe(error) })
        return undefined
      }
    },
    async collectCandidatesFromSnapshot(snapshot): Promise<CollectedRecallCandidates | undefined> {
      try {
        return await collectFrom(snapshot)
      } catch (error) {
        options.logger?.warn("omo-senpi memory recall candidate collection skipped", { error: describe(error) })
        return undefined
      }
    },
  }
}

interface RecallInjection {
  readonly result: {
    readonly message: {
      readonly customType: typeof RECALL_CUSTOM_TYPE
      readonly content: string
      readonly display: false
    }
  }
  readonly paths: readonly string[]
}

interface RecallSession {
  readonly id: string
  readonly entries: readonly unknown[]
}

function isBeforeAgentStart(payload: unknown): boolean {
  return isRecord(payload) && payload.type === "before_agent_start"
}

/**
 * The judge's window, oldest first: both roles, memory-owned hidden channels excluded for the same
 * reason the planner excludes them - a previous hint is not conversation.
 */
function judgeTranscript(entries: readonly unknown[]): RecallTranscriptTurn[] {
  const turns: RecallTranscriptTurn[] = []
  for (let index = entries.length - 1; index >= 0 && turns.length < RECALL_TEXT_WINDOW; index -= 1) {
    const turn = judgeTurn(entries[index])
    if (turn !== undefined) turns.push(turn)
  }
  return turns.reverse()
}

function judgeTurn(entry: unknown): RecallTranscriptTurn | undefined {
  if (!isRecord(entry)) return undefined
  if (entry.type !== "message") return undefined
  const message = entry.message
  if (!isRecord(message)) return undefined
  if (message.role !== "user" && message.role !== "assistant") return undefined
  if (typeof message.customType === "string" && EXCLUDED_CUSTOM_TYPES.has(message.customType)) return undefined
  const text = textOf(message.content)
  if (text.trim().length === 0) return undefined
  return { role: message.role, text }
}

function readSession(eventCtx: unknown): RecallSession | undefined {
  if (!isRecord(eventCtx)) return undefined
  const manager = eventCtx.sessionManager
  if (!isRecord(manager)) return undefined
  const getSessionId = manager.getSessionId
  const getBranch = manager.getBranch
  if (typeof getSessionId !== "function" || typeof getBranch !== "function") return undefined
  const id = Reflect.apply(getSessionId, manager, [])
  const entries = Reflect.apply(getBranch, manager, [])
  if (typeof id !== "string" || id.length === 0 || !Array.isArray(entries)) return undefined
  return { id, entries }
}

/**
 * Newest-first USER texts for the planner. Memory-owned hidden custom messages are skipped: senpi
 * persists an injected recall block as a `custom_message` branch entry, so an unfiltered window
 * would rediscover the previous hint instead of the live conversation.
 */
function userTexts(entries: readonly unknown[]): string[] {
  const texts: string[] = []
  for (let index = entries.length - 1; index >= 0 && texts.length < RECALL_TEXT_WINDOW; index -= 1) {
    const text = userText(entries[index])
    if (text !== undefined) texts.push(text)
  }
  return texts
}

function userText(entry: unknown): string | undefined {
  if (!isRecord(entry)) return undefined
  if (entry.type === "custom_message" || entry.type === "custom") return undefined
  if (entry.type !== "message") return undefined
  const message = entry.message
  if (!isRecord(message)) return undefined
  if (message.role !== "user") return undefined
  if (typeof message.customType === "string" && EXCLUDED_CUSTOM_TYPES.has(message.customType)) return undefined
  const text = textOf(message.content)
  return text.trim().length === 0 ? undefined : text
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  const parts: string[] = []
  for (const block of content) {
    if (!isRecord(block) || block.type !== "text") continue
    if (typeof block.text === "string") parts.push(block.text)
  }
  return parts.join("\n")
}

function defaultCreateRepo(context: MemoryIdentityContext): GitMemoryRepo {
  return new GitMemoryRepo({ dir: context.identityPaths.repo, agentId: context.identity })
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
