// Delivery half of the kibitzer recall channel. before_agent_start drains the pending
// file the gate wrote and injects one hidden omo-kibitzer:recall message. Fail-open:
// an unreadable ledger or a failed visible trace never suppresses a nudge the judge
// already paid for.

import type { OmoMemorySettings } from "@oh-my-opencode/omo-config-core"
import { renderNudgeBlock, type RecallLedger, type RecallNudge } from "@oh-my-opencode/memory-core"

import type { ComponentLogger } from "../../extension/types"
import type { MemoryExtensionAPI } from "./capabilities"
import type { MemoryIdentityContext } from "./context"
import { resolveMemorySettings } from "./identity-runtime"
import { GATE_ENTRY_TYPE, NUDGED_ENTRY_TYPE, renderKibitzerGateEntry, renderKibitzerNudgedEntry, type KibitzerNudgedRecord } from "./kibitzer-notice"
import { renderRecallEntry } from "./recall-notice"
import { RECALL_CUSTOM_TYPE, readSession } from "./recall-session-read"

/** The pending handoff the gate writes and this turn drains; `take` is read-and-delete. */
export interface PendingNudgesPort {
  take(sessionId: string, options: { readonly currentEpoch: number }): Promise<RecallNudge[]>
}

export interface RecallDrainOptions {
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  readonly resolveSettings: () => OmoMemorySettings
  readonly env: Record<string, string | undefined>
  readonly ledgerFor: (context: MemoryIdentityContext) => RecallLedger
  readonly pendingFor: (context: MemoryIdentityContext) => PendingNudgesPort
  readonly drainQueued?: (sessionId: string, context: MemoryIdentityContext) => RecallNudge[]
  /**
   * The session's live compaction epoch, owned by the kibitzer gate wiring. A pending payload is
   * stamped with the epoch its judge ran under, so passing the live one here is what rejects a
   * verdict about a transcript a compaction has since rewritten. Absent means "never compacted",
   * matching the gate wiring's own default for an unknown session.
   */
  readonly currentCompactionEpoch?: (sessionId: string) => number
  readonly logger?: ComponentLogger
}

export interface RecallDrain {
  register(pi: MemoryExtensionAPI): void
}

// A memory worker child must never receive recall hints: it reasons ABOUT memory, and an injected
// hint would both pollute its transcript and re-enter memory on the next extraction pass. The
// reflection and facts sentinels are here for the sharper reason: those children must not judge
// or consume the hints produced by the kibitzer gate.
const CHILD_SENTINELS = ["SENPI_MEMORY_REFLECTION", "SENPI_MEMORY_FACTS"] as const

/**
 * Provenance recorded next to a surfaced path. The ledger keys on the path alone - the hash exists
 * so a reader can tell a gate-delivered hint from a lexically matched one.
 */
export const GATE_SURFACE_HASH = "kibitzer-gate"

export function createRecallDrain(options: RecallDrainOptions): RecallDrain {
  /** Drain the gate's pending nudges for this turn. Returns undefined when there is nothing to say. */
  async function inject(payload: unknown, eventCtx: unknown): Promise<RecallInjection | undefined> {
    if (!isBeforeAgentStart(payload)) return undefined
    if (CHILD_SENTINELS.some((sentinel) => options.env[sentinel] === "1")) return undefined
    const session = readSession(eventCtx)
    if (session === undefined) return undefined
    const context = options.resolveContext(session.id)
    if (context === undefined) return undefined
    if (resolveAgentRecallSettings(options.resolveSettings(), context.identity).enabled === false) return undefined

    let fromFile: RecallNudge[] = []
    try {
      fromFile = await options.pendingFor(context).take(session.id, {
        currentEpoch: options.currentCompactionEpoch?.(session.id) ?? 0,
      })
    } catch (error) {
      options.logger?.warn("omo-senpi memory recall pending take skipped", { sessionId: session.id, error: describe(error) })
    }
    let fromQueue: RecallNudge[] = []
    try {
      fromQueue = options.drainQueued?.(session.id, context) ?? []
    } catch (error) {
      options.logger?.warn("omo-senpi memory recall queued drain skipped", { sessionId: session.id, error: describe(error) })
    }
    const nudges = dedupeByPath([...fromQueue, ...fromFile])
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
      nudges,
      sessionId: session.id,
    }

    try {
      await options.ledgerFor(context).markSurfaced(
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
      pi.registerEntryRenderer(NUDGED_ENTRY_TYPE, renderKibitzerNudgedEntry)
      pi.registerEntryRenderer(GATE_ENTRY_TYPE, renderKibitzerGateEntry)
      // Read aliases keep stored sessions renderable; new entries use Kibitzer only.
      pi.registerEntryRenderer("omo-memorian:recall", renderRecallEntry)
      pi.registerEntryRenderer("omo-memorian:nudged", renderKibitzerNudgedEntry)
      pi.registerEntryRenderer("omo-memorian:gate", renderKibitzerGateEntry)
      pi.on("before_agent_start", async (payload, eventCtx) => {
        try {
          const injection = await inject(payload, eventCtx)
          if (injection === undefined) return undefined
          try {
            // Visible half: the model-facing message is display:false, so without this entry the
            // user would see a memory-shaped answer with no trace of where it came from.
            pi.appendEntry(NUDGED_ENTRY_TYPE, {
              version: 1,
              nudges: injection.nudges.map(({ path, hint }) => ({ path, hint })),
              via: "prompt",
            } satisfies KibitzerNudgedRecord)
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
  readonly nudges: readonly RecallNudge[]
  readonly sessionId: string
}

function isBeforeAgentStart(payload: unknown): boolean {
  return isRecord(payload) && payload.type === "before_agent_start"
}

function resolveAgentRecallSettings(
  settings: OmoMemorySettings | undefined,
  agentId: string,
): { readonly enabled: boolean } {
  const resolved = resolveMemorySettings(settings)
  return { ...resolved.recall, ...resolved.agents[agentId]?.recall }
}

function dedupeByPath(nudges: readonly RecallNudge[]): RecallNudge[] {
  const seen = new Set<string>()
  return nudges.filter((nudge) => {
    if (seen.has(nudge.path)) return false
    seen.add(nudge.path)
    return true
  })
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
