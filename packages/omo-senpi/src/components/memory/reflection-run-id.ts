import {
  REFLECTION_RUN_ID_PREFIX,
  readReflectionRunIdMark,
  recordReflectionRunIdMark,
  scanReflectionRunHighWater,
  type MemoryIdentityPaths,
} from "@oh-my-opencode/memory-core"

/**
 * Mints reflection run ids one past the highest id still ON DISK, the same way the facts lane
 * derives its attempt sequence.
 *
 * A bare per-process counter restarts at 1 on every launch, so a later generation re-mints a
 * retired id and collides with that run's durable completion record
 * ("Reflection completion record mismatch for reflection-run-1"), wedging launch, reconcile, and
 * finalization permanently (issue #7095). Scanning persisted state instead means a name is handed
 * back only once no trace of it survives, which is also what makes manual cleanup effective.
 *
 * The durable `reflection/run-id.json` mark is a fifth input and is raised on every mint, so runtime
 * retention can prune old traces without lowering the high water. The reservation store awaits
 * this factory inside the `reflection-scheduler` lock, which is what makes that write race-free.
 */
export function createReflectionRunIdFactory(input: {
  readonly identityPaths: MemoryIdentityPaths
}): () => Promise<string> {
  let highWater = 0
  return async () => {
    const [scanned, mark] = await Promise.all([
      scanReflectionRunHighWater(input.identityPaths),
      readReflectionRunIdMark(input.identityPaths.reflection),
    ])
    highWater = Math.max(highWater, scanned, mark ?? 0) + 1
    await recordReflectionRunIdMark(input.identityPaths.reflection, highWater)
    return `${REFLECTION_RUN_ID_PREFIX}${highWater}`
  }
}
