// One sidecar's shared state. Everything `createKibitzerSidecar` keeps for the lifetime of a bound
// session lives on this record so the lifecycle modules (`sidecar-turn`, `sidecar-admission`,
// `sidecar-recovery`, `sidecar-wake`) can read and advance it. The record adds no locking of its
// own: every transition still runs under the per-session mutex `serialized`.

import type { RecallCandidate, RecallNudge } from "@oh-my-opencode/memory-core"
import type { ChildHandle } from "@oh-my-opencode/senpi-task"

import { createKibitzerEventStream, type KibitzerEvent, type KibitzerEventDigest, type KibitzerEventStream } from "./events"
import {
  KIBITZER_RESEED_FRACTION,
  KIBITZER_SIDECAR_MAX_TOKENS,
  KIBITZER_WAKE_DEADLINE_MS,
  KIBITZER_WAKE_TOOL_BUDGET,
  type KibitzerSidecarOptions,
  type KibitzerSidecarState,
  type KibitzerSidecarTimers,
} from "./sidecar-contract"
import type { KibitzerWakeAbort, KibitzerWakeUsage } from "./sidecar-outcome"
import type { KibitzerReseedInput } from "./sidecar-prompt"
import { createWakeToolBudget, type KibitzerSidecarTools, type WakeToolBudget } from "./tools"
import { createAcceptedNudgeCooldown, type AcceptedNudgeCooldown } from "./wake-policy"
import type { KibitzerWakeLease } from "./wake-slot"

/** Events and candidates that one envelope carried; kept until the child is known to have read them. */
export interface Payload {
  readonly events: readonly KibitzerEvent[]
  readonly digest?: KibitzerEventDigest
  readonly candidates: readonly RecallCandidate[]
  readonly cursors?: { readonly first: number; readonly last: number }
}

export interface Envelope {
  readonly text: string
  readonly payload: Payload
  readonly steered: boolean
  /** Confirmed through the child's own `message_end` for the user message carrying `text`. */
  consumed: boolean
}

export interface Child {
  readonly handle: ChildHandle
  readonly generation: number
  readonly tools: KibitzerSidecarTools
  readonly unsubscribe: () => void
  /** `usage.input + usage.cacheRead` of the newest assistant message; undefined until usage is seen. */
  usageTokens: number | undefined
  /** Every character the sidecar sent, for the char/4 fallback. */
  charsSent: number
}

export interface Turn {
  readonly wake: number
  readonly generation: number
  readonly maxItems: number
  readonly startedAt: number
  readonly accepted: RecallNudge[]
  readonly budget: WakeToolBudget
  readonly envelopes: Envelope[]
  /** The machine-wide lease this turn holds; undefined once released. */
  lease: KibitzerWakeLease | undefined
  /** Time the wake spent waiting for its lease. */
  slotWaitMs: number
  candidateCount: number
  toolStarts: number
  toolEnds: number
  abort: KibitzerWakeAbort | undefined
  deadline: unknown
  model: string | undefined
  /** Provider usage summed over the turn's assistant messages; undefined until one reports usage. */
  usage: KibitzerWakeUsage | undefined
  settled: Promise<void>
}

export interface SidecarCore {
  readonly sessionId: string
  readonly options: KibitzerSidecarOptions
  readonly now: () => number
  readonly random: () => number
  readonly timers: KibitzerSidecarTimers
  readonly toolBudget: number
  readonly wakeDeadlineMs: number
  readonly reseedAtTokens: number
  readonly cooldown: AcceptedNudgeCooldown
  readonly stream: KibitzerEventStream
  state: KibitzerSidecarState
  child: Child | undefined
  activeTurn: Turn | undefined
  wakeSeq: number
  generations: number
  consecutiveFailures: number
  backoffTimer: unknown
  /** Set the instant shutdown is requested, before it reaches the mutex: no wake may start after it. */
  closing: boolean
  /** The lease wait in flight, if any; shutdown aborts it instead of queueing behind it. */
  admission: AbortController | undefined
  pendingReseed: Omit<KibitzerReseedInput, "maxItems" | "toolBudget"> | undefined
  taskSummary: string | undefined
  /** Payloads no child has confirmed reading: replayed by the next envelope, oldest first. */
  carry: Payload[]
  /** Live sets the nudge closure reads at call time; the same objects for every child. */
  readonly offered: Set<string>
  readonly surfaced: Set<string>
  readonly offeredAtWake: Map<string, number>
  readonly delivered: Set<string>
  /** The CURRENT wake's slots; the tools read them through the binding's getters. */
  accepted: RecallNudge[]
  budget: WakeToolBudget
  /** The per-session mutex: every transition runs through it, in order. */
  serialized<T>(task: () => Promise<T>): Promise<T>
  /** Resolves once every queued transition has run and the running turn, if any, has settled. */
  whenIdle(): Promise<void>
  warn(message: string, details?: Record<string, unknown>): void
}

export function createSidecarCore(options: KibitzerSidecarOptions): SidecarCore {
  const { sessionId } = options
  const now = options.now ?? Date.now
  const toolBudget = options.toolBudget ?? KIBITZER_WAKE_TOOL_BUDGET
  let chain: Promise<unknown> = Promise.resolve()
  const core: SidecarCore = {
    sessionId,
    options,
    now,
    random: options.random ?? Math.random,
    timers: options.timers ?? RUNTIME_TIMERS,
    toolBudget,
    wakeDeadlineMs: options.wakeDeadlineMs ?? KIBITZER_WAKE_DEADLINE_MS,
    reseedAtTokens: Math.floor((options.sidecarMaxTokens ?? KIBITZER_SIDECAR_MAX_TOKENS) * KIBITZER_RESEED_FRACTION),
    cooldown: createAcceptedNudgeCooldown({ now }),
    stream: createKibitzerEventStream({
      now,
      ...(options.eventCaps === undefined ? {} : { caps: options.eventCaps }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    }),
    state: "idle",
    child: undefined,
    activeTurn: undefined,
    wakeSeq: 0,
    generations: 0,
    consecutiveFailures: 0,
    backoffTimer: undefined,
    closing: false,
    admission: undefined,
    pendingReseed: undefined,
    taskSummary: undefined,
    carry: [],
    offered: new Set<string>(),
    surfaced: new Set<string>(),
    offeredAtWake: new Map<string, number>(),
    delivered: new Set<string>(),
    accepted: [],
    budget: createWakeToolBudget(toolBudget),
    serialized<T>(task: () => Promise<T>): Promise<T> {
      const run = chain.then(task, task)
      chain = run.catch(() => undefined)
      return run
    },
    async whenIdle(): Promise<void> {
      for (;;) {
        await chain
        const turn = core.activeTurn
        if (turn === undefined) return
        await turn.settled
      }
    },
    warn(message, details = {}): void {
      options.logger?.warn(message, { sessionId, ...details })
    },
  }
  return core
}

const RUNTIME_TIMERS: KibitzerSidecarTimers = {
  set(callback, ms) {
    const handle = setTimeout(callback, ms)
    handle.unref?.()
    return handle
  },
  clear(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

export function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((block) => (isRecord(block) && block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .join("")
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
