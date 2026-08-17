import { randomBytes } from "node:crypto"

const RUN_ID_PREFIX = "reflection-run-"

// A run id names a durable run directory and completion record. A per-process counter restarts
// at 1 every launch, so a later session re-mints a retired id, adopts that run directory and
// inherits its terminal sentinels. Uniqueness must hold across processes and days, not per process.
export function createReflectionRunId(
  now: () => number = Date.now,
  entropy: (size: number) => Buffer = randomBytes,
): string {
  return `${RUN_ID_PREFIX}${now()}-${entropy(4).toString("hex")}`
}
