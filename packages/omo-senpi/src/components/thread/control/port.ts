import { threadToolFailure, type ThreadErrorCode, type ThreadToolFailure } from "../errors"
import type { ThreadTranscriptEntry } from "../reader"
import type { ModelChoice } from "../tools/model-match"
import type { ThreadCloseOutcome } from "../tools/ports"
import type { ThreadSummary } from "../contracts"

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
  /** The engine's own `interrupt`: an idle session answers `interrupted: false`. */
  readonly interrupt: (turnId?: string) => Promise<{ readonly interrupted: boolean; readonly turn_id?: string }>
  /** The one close ladder (`close-ladder.ts`) on the thread's engine. */
  readonly close: () => Promise<ThreadCloseOutcome>
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
  /** Refuses `thinking_level_unsupported` for a level the active model cannot run. */
  readonly setThinkingLevel: (level: string, scope?: "turn") => Promise<void>
  readonly getMessages: () => Promise<readonly ThreadTranscriptEntry[]>
}

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

/** The thread a result names: its id, and its device when it is on another one. */
export function controlIdentity(control: Pick<SessionControl, "thread_id" | "device">): {
  readonly thread_id: string
  readonly device?: string
} {
  return { thread_id: control.thread_id, ...(control.device === undefined ? {} : { device: control.device }) }
}
