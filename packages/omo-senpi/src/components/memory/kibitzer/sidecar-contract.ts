// The resident Kibitzer's public contract: the defaults the wake budget, deadline and reseed
// threshold fall back to, and the types a host needs to build, feed and observe one sidecar. The
// lifecycle itself is `createKibitzerSidecar` in `sidecar.ts` and the modules behind it.

import type { RecallCandidate, RecallNudge } from "@oh-my-opencode/memory-core"
import type { ChildHandle } from "@oh-my-opencode/senpi-task"

import type { ComponentLogger } from "../../../extension/types"
import type { KibitzerEventCaps, KibitzerEventStream } from "./events"
import type { KibitzerWakeOutcome } from "./sidecar-outcome"
import type { KibitzerSidecarTools, KibitzerSidecarToolsInput } from "./tools"
import type { AnyKibitzerSidecarTool } from "./tools/result"
import type { WakeSilenceReason } from "./wake-policy"
import type { KibitzerWakeSlot } from "./wake-slot"

/** `memory.recall.tool_budget` default: child tool calls one wake may spend before it is cut off. */
export const KIBITZER_WAKE_TOOL_BUDGET = 8
/** A wake that has not settled in this long is aborted; whatever it accepted so far is kept. */
export const KIBITZER_WAKE_DEADLINE_MS = 90_000
/** `memory.recall.sidecar_max_tokens` default: the context window the reseed threshold is taken from. */
export const KIBITZER_SIDECAR_MAX_TOKENS = 48_000
/** The child is replaced once its context estimate reaches this share of `sidecarMaxTokens`. */
export const KIBITZER_RESEED_FRACTION = 0.6
/** A path offered this many wakes ago without a nudge is carried into the reseed as rejected. */
export const KIBITZER_REJECTED_AFTER_WAKES = 3

export type KibitzerSidecarState = "idle" | "turn_running" | "reseeding" | "backoff" | "disposed"

/** Injectable timers: production uses the runtime's (unref'd); tests fire them by hand. */
export interface KibitzerSidecarTimers {
  set(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
}

/** What the sidecar hands its child factory: the first user message and the tools it may call. */
export interface KibitzerSidecarChildInput {
  readonly sessionId: string
  /** 1 for the first child, +1 per recreation (backoff or reseed). */
  readonly generation: number
  /** The seed envelope, or the reseed envelope followed by the first wake envelope. */
  readonly prompt: string
  readonly tools: readonly AnyKibitzerSidecarTool[]
  /** `memory.recall.max_items` at creation; the nudge closure is bound to it for this child. */
  readonly maxItems: number
}

/** The sidecar-owned half of the tool input: live nudge sets and the current wake's budget. */
export type KibitzerSidecarToolBinding = Pick<KibitzerSidecarToolsInput, "nudge" | "budget">

export interface KibitzerSidecarOptions {
  readonly sessionId: string
  /** Starts the resident child with its first turn already running (senpi-task `ChildHandle`). */
  readonly startChild: (input: KibitzerSidecarChildInput) => Promise<ChildHandle>
  /** Builds the five closures over the host-owned workspace/session/memory plus this binding. */
  readonly createTools: (binding: KibitzerSidecarToolBinding) => KibitzerSidecarTools
  /**
   * Hands re-validated nudges to the unchanged delivery path (ledger mark, hold, steer at the next
   * tool_result / passive coordinator / prompt drain).
   */
  readonly deliver: (nudges: readonly RecallNudge[], outcome: Pick<KibitzerWakeOutcome, "wake" | "generation">) => Promise<void>
  /** Every settled wake, including failures and aborts; the observability lane persists these. */
  readonly onWake?: (outcome: KibitzerWakeOutcome) => void
  /** The machine-wide wake lease; one lease is held for the whole of every provider turn. */
  readonly wakeSlot: KibitzerWakeSlot
  /** `memory.recall.tool_budget`. */
  readonly toolBudget?: number
  readonly wakeDeadlineMs?: number
  /** `memory.recall.sidecar_max_tokens`: the child is reseeded once its estimate reaches 60% of this. */
  readonly sidecarMaxTokens?: number
  /** `memory.recall.event_caps`. */
  readonly eventCaps?: Partial<KibitzerEventCaps>
  readonly now?: () => number
  readonly random?: () => number
  readonly timers?: KibitzerSidecarTimers
  readonly logger?: ComponentLogger
}

export interface KibitzerOfferInput {
  /** Lexical recall candidates collected for the newest prompt / tool_call hook. */
  readonly candidates: readonly RecallCandidate[]
  /** The session's surfaced ledger as read for this batch; stays authoritative over the child. */
  readonly surfaced: ReadonlySet<string>
  /** `memory.recall.max_items` resolved for the bound agent. */
  readonly maxItems: number
  /** One line naming the task; the first prompt's head is used when absent. */
  readonly taskSummary?: string
}

export type KibitzerBufferedReason = WakeSilenceReason | "backoff" | "slot_busy" | "disposed"

export type KibitzerOfferResult =
  /** A new child was created (first wake, or after backoff / reseed). */
  | { readonly action: "seeded"; readonly wake: number }
  /** The idle resident child was revived. */
  | { readonly action: "followed_up"; readonly wake: number }
  /** The batch joined the running turn. */
  | { readonly action: "steered"; readonly wake: number }
  /** No model turn: the events stay buffered for the next real wake. */
  | { readonly action: "buffered"; readonly reason: KibitzerBufferedReason }

export interface KibitzerSidecar {
  readonly sessionId: string
  state(): KibitzerSidecarState
  /** Synchronous hook capture; buffers only, never wakes, never throws. Ignored once disposed. */
  readonly events: Pick<KibitzerEventStream, "onPrompt" | "onToolCall" | "onToolResult" | "size" | "lastCursor">
  /** The trigger: decides, serialized per session, whether this batch wakes the child and how. */
  offer(input: KibitzerOfferInput): Promise<KibitzerOfferResult>
  /** Session shutdown: aborts a running turn, disposes the child, never recreates. Idempotent. */
  shutdown(): Promise<void>
  /** Resolves once every queued transition has run and the running turn, if any, has settled. */
  whenIdle(): Promise<void>
}
