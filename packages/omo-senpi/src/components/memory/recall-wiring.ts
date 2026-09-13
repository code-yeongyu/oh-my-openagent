// Kibitzer recall wiring (plan .omo/plans/memorian-m3-gate.md todo 1).
//
// Recall owns its OWN before_agent_start handler, NOT an extra field on the memory prompt
// handler's result: senpi's ExtensionRunner.emitBeforeAgentStart pushes every handler's
// `result.message` into a combined `messages[]` array, so two handlers of the same extension each
// contribute one message. That separation is the invariant that keeps recall away from
// systemPrompt.
//
// The lexical auto-injection path is GONE: nothing is injected from a plain corpus match. Candidate
// collection runs over a plain session snapshot (captured synchronously at a prompt or tool_call
// hook by the Kibitzer composition) and offers its candidates to the session's resident sidecar,
// whose validated nudges are what a later turn injects. before_agent_start is the delivery half:
// it only drains the pending file delivery wrote. Every step stays fail-open: an unreadable memory
// repo or a corrupt corpus drops the collection and logs, and the turn proceeds untouched.

import type { OmoMemoryRecall, OmoMemorySettings } from "@oh-my-opencode/omo-config-core"
import {
  GitMemoryRepo,
  PendingNudges,
  RecallCorpusCache,
  RecallLedger,
  planRecallQueries,
  selectRecallCandidates,
  type RecallCandidate,
  type RecallNudge,
} from "@oh-my-opencode/memory-core"

import type { ComponentLogger } from "../../extension/types"
import type { MemoryExtensionAPI } from "./capabilities"
import type { MemoryIdentityContext } from "./context"
import { resolveMemorySettings } from "./identity-runtime"
import { createRecallDrain, type PendingNudgesPort } from "./recall-drain"
import {
  judgeTranscript,
  readSession,
  userTexts,
  type RecallSession,
  type RecallSessionSnapshot,
  type RecallTranscriptTurn,
} from "./recall-session-read"

export {
  RECALL_CUSTOM_TYPE,
  type RecallSession,
  type RecallSessionSnapshot,
  type RecallTranscriptTurn,
} from "./recall-session-read"
export type { PendingNudgesPort }

export type ResolvedMemoryRecallSettings = OmoMemoryRecall

/**
 * Base recall block under the bound agent's layer override, mirroring the nudge/reflection pattern.
 * `event_caps` merges per field, so an agent that tightens one cap keeps the root's other three.
 */
export function resolveAgentRecallSettings(
  settings: OmoMemorySettings | undefined,
  agentId: string,
): ResolvedMemoryRecallSettings {
  const resolved = resolveMemorySettings(settings)
  const base = resolved.recall
  const override = resolved.agents[agentId]?.recall
  return { ...base, ...override, event_caps: { ...base.event_caps, ...override?.event_caps } }
}

export interface MemoryRecallWiringOptions {
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  /** Full memory settings; the bound agent's recall override is applied internally. */
  readonly resolveSettings: () => OmoMemorySettings
  readonly env: Record<string, string | undefined>
  readonly createRepo?: (context: MemoryIdentityContext) => GitMemoryRepo
  readonly corpusCache?: RecallCorpusCache
  readonly ledgerFor?: (context: MemoryIdentityContext) => RecallLedger
  readonly pendingFor?: (context: MemoryIdentityContext) => PendingNudgesPort
  readonly drainQueued?: (sessionId: string, context: MemoryIdentityContext) => RecallNudge[]
  readonly logger?: ComponentLogger
}

/** Everything the Kibitzer sidecar needs about one hook's lexical candidates. */
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

export interface MemoryRecallWiring {
  register(pi: MemoryExtensionAPI): void
  /** Settle-time seam: lexical candidates for the completed turn, or undefined when there are none. */
  collectCandidates(
    eventCtx: unknown,
    extraTexts?: readonly string[],
  ): Promise<CollectedRecallCandidates | undefined>
  /**
   * Synchronous ctx read for detached callers. Returns undefined when the ctx carries no usable
   * session; never throws, so a disposed ctx degrades to "no candidates" instead of a failed turn.
   */
  snapshotSession(eventCtx: unknown): RecallSessionSnapshot | undefined
  /** Collection over an already-captured snapshot; touches no ctx at all. */
  collectCandidatesFromSnapshot(
    snapshot: RecallSessionSnapshot,
    extraTexts?: readonly string[],
  ): Promise<CollectedRecallCandidates | undefined>
}

// A memory worker child must never receive recall hints: it reasons ABOUT memory, and an injected
// hint would both pollute its transcript and re-enter memory on the next extraction pass. The
// reflection and facts sentinels are here for the sharper reason: those children must not judge
// or consume the hints produced by the Kibitzer sidecar.
const CHILD_SENTINELS = ["SENPI_MEMORY_REFLECTION", "SENPI_MEMORY_FACTS"] as const
const RECALL_PATH_ENTRY_WINDOW = 200

export function createMemoryRecallWiring(options: MemoryRecallWiringOptions): MemoryRecallWiring {
  const corpusCache = options.corpusCache ?? new RecallCorpusCache()
  const createRepo = options.createRepo ?? defaultCreateRepo
  const ledgerFor = options.ledgerFor ?? ((context) => new RecallLedger(context.identityPaths.recallLedger))
  const pendingFor = options.pendingFor ?? ((context) => new PendingNudges(context.identityPaths.recallPending))
  const drain = createRecallDrain({
    resolveContext: options.resolveContext,
    resolveSettings: options.resolveSettings,
    env: options.env,
    ledgerFor,
    pendingFor,
    ...(options.drainQueued === undefined ? {} : { drainQueued: options.drainQueued }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  })

  async function collect(eventCtx: unknown, extraTexts: readonly string[] = []): Promise<CollectedRecallCandidates | undefined> {
    if (CHILD_SENTINELS.some((sentinel) => options.env[sentinel] === "1")) return undefined
    // agent_settled carries no session fields, so the session is read from the event context the
    // same way the before_agent_start handler reads it.
    const session = readSession(eventCtx)
    if (session === undefined) return undefined
    return await collectFrom(session, extraTexts)
  }

  /** The ctx-free remainder of collection: everything below runs off plain captured values. */
  async function collectFrom(session: RecallSession, extraTexts: readonly string[] = []): Promise<CollectedRecallCandidates | undefined> {
    if (CHILD_SENTINELS.some((sentinel) => options.env[sentinel] === "1")) return undefined
    const context = options.resolveContext(session.id)
    if (context === undefined) return undefined

    const recall = resolveAgentRecallSettings(options.resolveSettings(), context.identity)
    if (recall.enabled === false) return undefined

    // USER-role texts only: candidates are keyed on user intent, and assistant prose (which often
    // paraphrases memory back at the user) would skew matching. Tool-arg harvests get their own
    // newest-first slots so a filename can score even when user chatter owns both default singles.
    const texts = userTexts(session.entries)
    if (texts.length === 0 && extraTexts.length === 0) return undefined
    const queries = extraTexts.length === 0
      ? planRecallQueries(texts)
      : planRecallQueries(texts, { toolTexts: [...extraTexts].reverse() })
    if (queries.length === 0) return undefined

    const repo = createRepo(context)
    const corpus = await corpusCache.load(repo)
    if (corpus.documents.length === 0) return undefined

    // Raw entries include tool calls/results that the judge's text-only window omits.
    // Serialize the bounded window once; the corpus supplies the exact memory paths to check.
    const recentEntries = JSON.stringify(session.entries.slice(-RECALL_PATH_ENTRY_WINDOW))
    const excludePaths = new Set<string>()
    for (const document of corpus.documents) {
      const path = JSON.stringify(document.path).slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      // Close at transcript delimiters (including JSON-escaped whitespace), not filename suffixes.
      const mention = new RegExp(`${path}(?=$|[\\s"'\x60\\])}>:;,!?]|\\\\["nrtbf])`)
      if (mention.test(recentEntries)) excludePaths.add(document.path)
    }

    const ledger = ledgerFor(context)
    const surfaced = await ledger.surfacedPaths(session.id)
    const candidates = selectRecallCandidates(corpus.documents, queries, {
      maxItems: recall.max_items,
      surfaced,
      excludePaths,
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

  return {
    register(pi): void {
      drain.register(pi)
    },
    async collectCandidates(eventCtx, extraTexts = []): Promise<CollectedRecallCandidates | undefined> {
      try {
        return await collect(eventCtx, extraTexts)
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
    async collectCandidatesFromSnapshot(snapshot, extraTexts = []): Promise<CollectedRecallCandidates | undefined> {
      try {
        return await collectFrom(snapshot, extraTexts)
      } catch (error) {
        options.logger?.warn("omo-senpi memory recall candidate collection skipped", { error: describe(error) })
        return undefined
      }
    },
  }
}

function defaultCreateRepo(context: MemoryIdentityContext): GitMemoryRepo {
  return new GitMemoryRepo({ dir: context.identityPaths.repo, agentId: context.identity })
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
