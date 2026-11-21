import { threadToolFailure, type ThreadErrorCode, type ThreadToolFailure } from "../errors"
import type { EntryPageRead } from "../paged-reader"
import type { ThreadTranscriptEntry } from "../reader"
import type { InterruptOutcome } from "./interrupt"
import type { ModelChoice } from "../tools/model-match"
import type { ThreadCloseAnswer, ThreadCloseOptions } from "../tools/ports"
import type { ThreadResultSummary, ThreadSummary, ThreadWaitOutcome } from "../contracts"

/**
 * One live thread's controls, wherever it is held: the session on this device's endpoint, or the session on another
 * device of the account. Every control tool has one body over this port; `locateControl` picks the implementation,
 * and nothing past it reads the device again. A method refuses with a `ControlRefusal` carrying the tool failure the
 * body answers as data; anything else it throws is the leg's own transport failure, mapped where it always was.
 */
export type SessionControl = {
  readonly thread_id: string
  /** The account device holding the thread, when it is not this one. */
  readonly device?: string
  /** The thread's title as its listing names it. */
  readonly title: string
  /** Names on the target device that a rename must not take. */
  readonly visible: () => Promise<readonly ThreadSummary[]>
  /** `interruptOver` on this leg's transport: an idle session answers `interrupted: false`. */
  readonly interrupt: (turnId?: string) => Promise<InterruptOutcome>
  /** The one close ladder (`close-ladder.ts`) on the thread's engine. */
  readonly close: (options?: ThreadCloseOptions) => Promise<ThreadCloseAnswer>
  readonly setName: (name: string) => Promise<void>
  /**
   * The session's model catalog. `held`: answered from a copy the leg keeps (bounded in age), on which only an exact
   * provider/id is decided; `fresh` bypasses that copy.
   */
  readonly getAvailableModels: (options?: {
    readonly fresh?: boolean
  }) => Promise<{ readonly models: readonly ModelChoice[]; readonly held: boolean }>
  readonly setModel: (provider: string, id: string) => Promise<{ readonly provider: string; readonly id: string }>
  readonly getAvailableThinkingLevels: () => Promise<readonly string[]>
  /**
   * Changes only this session's level (`SESSION_ONLY_THINKING_SCOPE`), never the device's remembered level for the
   * model. Refuses `thinking_level_unsupported` for a level the active model cannot run.
   */
  readonly setThinkingLevel: (level: string) => Promise<void>
  readonly getMessages: () => Promise<readonly ThreadTranscriptEntry[]>
  /**
   * One page of the session's newest entries, sent by its holder (`paged-reader.ts`, #14047). `unsupported`: the holder
   * pages nothing, and the read takes the whole transcript (`getMessages`). Absent: this leg always reads it whole.
   */
  readonly readEntryPage?: (read: {
    readonly max_bytes?: number
    readonly cursor?: string
  }) => Promise<EntryPageRead | { readonly kind: "unsupported" }>
  /**
   * Waits, bounded, until the thread's turn is observed to end, on the leg's own status events (never a polling loop):
   * `wait-settled.ts` over the remote watch on another device, over the endpoint's session subscription on this one.
   */
  readonly waitSettled: (timeoutMs: number, signal?: AbortSignal) => Promise<ThreadWaitOutcome>
  /** Whether a turn is in flight: the listing's activity, else the engine's own `get_state`. */
  readonly running: () => Promise<boolean>
  /**
   * senpi `set_session_archived`: the archived flag in the session file, nothing else (the desktop's `thread_organize`
   * archive also unloads the session). Refuses `unsupported` when the engine does not know the command.
   */
  readonly setArchived: (archived: boolean) => Promise<void>
  /** The thread as `thread_list` lists it, with the archived flag set to `archived`. */
  readonly listed: (archived: boolean) => Promise<ThreadResultSummary>
}

/**
 * The engine's `set_thinking_level` scope that changes only the addressed session (`setSessionThinkingLevel`). Any
 * other scope also rewrites the device's remembered level for the model, which a thread tool never asks for.
 */
export const SESSION_ONLY_THINKING_SCOPE = "turn"

// Keyed through the global symbol registry: the thread client sidecar and the extension bundle each carry their own
// copy of this module, so an `instanceof` across them would not hold.
const REFUSAL = Symbol.for("omo.thread.control.refusal")

/** A control method's typed refusal: the failure the tool body answers, as data, for the thread it addressed. */
export class ControlRefusal extends Error {
  readonly [REFUSAL] = true
  constructor(readonly failure: ThreadToolFailure) {
    super(failure.message)
    this.name = "ControlRefusal"
  }
}

export function refuse(
  code: ThreadErrorCode,
  message: string,
  next: string,
  details?: Readonly<Record<string, unknown>>,
): ControlRefusal {
  return new ControlRefusal(threadToolFailure(code, message, next, details))
}

export function controlRefusalOf(error: unknown): ThreadToolFailure | undefined {
  return typeof error === "object" && error !== null && (error as { readonly [REFUSAL]?: unknown })[REFUSAL] === true
    ? (error as ControlRefusal).failure
    : undefined
}

/** The thread a result names: `thread`, the address to pass back, and its device when it is on another one. */
export function controlIdentity(control: Pick<SessionControl, "thread_id" | "device">): {
  readonly thread: string
  readonly device?: string
} {
  return { thread: control.thread_id, ...(control.device === undefined ? {} : { device: control.device }) }
}
