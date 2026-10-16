import { join } from "node:path"

import type { ReflectionOutcome, ReservedRun } from "./machine"
import {
  applyReflectionParkFailure,
  clearReflectionPark,
  emptyReflectionParkState,
  isAutomaticReflectionRequest,
  isReflectionParked,
  isUnreadableReflectionParkState,
  parseReflectionParkState,
  type ReflectionFailureSignal,
  type ReflectionParkState,
} from "./park"
import { readJsonOptional, unlinkIfPresent, writeJsonAtomic } from "./reservation-files"

export const PARK_FILENAME = "park.json"

export interface ReflectionParkTransition {
  readonly state: ReflectionParkState
  readonly parked: boolean
  readonly justParked: boolean
}

/** Lock-free read for status surfaces; the scheduler writes the file atomically, so a reader sees one whole state. */
export async function readReflectionParkFile(reflectionDir: string): Promise<ReflectionParkState> {
  const parsed = await readJsonOptional(join(reflectionDir, PARK_FILENAME))
  return parsed === null ? emptyReflectionParkState() : parseReflectionParkState(parsed)
}

/**
 * The durable park record of one identity. Every method assumes the caller holds the reflection
 * scheduler lock; the reservation store is the only writer.
 */
export class ReflectionParkFile {
  private readonly path: string

  constructor(
    private readonly reflectionDir: string,
    private readonly now: () => Date,
  ) {
    this.path = join(reflectionDir, PARK_FILENAME)
  }

  // An unreadable park file must never block reflection: /doctor reports it, and the next park
  // transition rewrites it. Only parse failures are tolerated; I/O errors still propagate.
  async read(): Promise<ReflectionParkState> {
    try {
      return await readReflectionParkFile(this.reflectionDir)
    } catch (error) {
      if (isUnreadableReflectionParkState(error)) return emptyReflectionParkState()
      throw error
    }
  }

  async write(state: ReflectionParkState): Promise<void> {
    if (!isReflectionParked(state) && state.streak === 0) {
      await unlinkIfPresent(this.path)
      return
    }
    await writeJsonAtomic(this.path, state)
  }

  async transition(
    active: ReservedRun | undefined,
    runId: string,
    outcome: ReflectionOutcome,
    failure: ReflectionFailureSignal | undefined,
  ): Promise<ReflectionParkTransition> {
    const before = await this.read()
    if (outcome === "merged" || outcome === "no_changes") {
      const cleared = clearReflectionPark()
      if (isReflectionParked(before) || before.streak > 0) await this.write(cleared)
      return { state: cleared, parked: false, justParked: false }
    }
    if (active === undefined || !isAutomaticReflectionRequest(active.request)) {
      return { state: before, parked: isReflectionParked(before), justParked: false }
    }
    const after = applyReflectionParkFailure(before, {
      runId,
      at: this.now().toISOString(),
      ...(failure ?? { fingerprint: `${outcome}:`, retryable: true }),
    })
    await this.write(after)
    return { state: after, parked: isReflectionParked(after), justParked: isReflectionParked(after) && !isReflectionParked(before) }
  }
}
