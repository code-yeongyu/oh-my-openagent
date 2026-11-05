import { readRecordedRunIdHighWater, scanRunIdHighWater, type MemoryIdentityPaths } from "@oh-my-opencode/memory-core"

const RUN_ID_PREFIX = "reflection-run-"

/**
 * Mints reflection run ids one past the highest id still ON DISK, the same way the facts lane
 * derives its attempt sequence.
 *
 * A bare per-process counter restarts at 1 on every launch, so a later generation re-mints a
 * retired id and collides with that run's durable completion record
 * ("Reflection completion record mismatch for reflection-run-1"), wedging launch, reconcile, and
 * finalization permanently (issue #7095). Scanning persisted state instead means a name is handed
 * back only once no trace of it survives, which is also what makes manual cleanup effective. The
 * recorded mark in `run-id.json` is a fifth input: a trace moved aside (a torn `active.lock`,
 * #11976) still keeps its number from being minted again.
 */
export function createReflectionRunIdFactory(input: {
  readonly identityPaths: MemoryIdentityPaths
}): () => Promise<string> {
  let highWater = 0
  return async () => {
    const [scanned, recorded] = await Promise.all([
      scanRunIdHighWater(input.identityPaths),
      readRecordedRunIdHighWater(input.identityPaths.reflection),
    ])
    highWater = Math.max(highWater, scanned, recorded) + 1
    return `${RUN_ID_PREFIX}${highWater}`
  }
}
