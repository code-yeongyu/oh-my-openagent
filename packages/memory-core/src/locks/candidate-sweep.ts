import path from "node:path"

import { readdir, stat, unlink } from "../fs/resilient"

export const CANDIDATE_STALE_AGE_MS = 60 * 60 * 1000

// Lock DOMAIN names may legally contain ".candidate-" (runFinalizationLockPath permits dots
// and hyphens in run ids), so only the exact UUID-suffixed shape publishExclusive generates
// is ever treated as sweepable garbage.
const LEAKED_CANDIDATE_NAME =
  /\.candidate-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

// Crashed contenders leak `<lock>.candidate-<uuid>` files: publishExclusive unlinks its
// candidate in a finally block, but SIGKILL mid-publish skips it. Nothing ever reads a
// candidate after publish, so age is the only liveness signal the sweeper needs; live lock
// and recovery files never contain ".candidate-" and are never touched.
export async function sweepStaleLockCandidates(
  lockDirectory: string,
  now: () => number = Date.now,
): Promise<number> {
  let names: readonly string[]
  try {
    names = await readdir(lockDirectory)
  } catch (error) {
    if (errorCode(error) === "ENOENT") return 0
    throw error
  }
  let swept = 0
  for (const name of names) {
    if (!LEAKED_CANDIDATE_NAME.test(name)) continue
    const candidatePath = path.join(lockDirectory, name)
    try {
      const status = await stat(candidatePath)
      if (now() - status.mtimeMs <= CANDIDATE_STALE_AGE_MS) continue
      await unlink(candidatePath)
      swept += 1
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error
    }
  }
  return swept
}
