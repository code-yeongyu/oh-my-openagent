import { readdir, stat } from "@oh-my-opencode/memory-core/fs"
import { getPidLiveness, type ProcessLiveness } from "@oh-my-opencode/memory-core"
import { join } from "node:path"

import { unlinkRunArtifact } from "./run-artifacts"

// Startup can overlap another session's writes. UUID-only legacy temporaries have no owner
// identity, so give them a full day; PID-bearing temporaries also require confirmed death.
const STRANDED_TEMP_MIN_AGE_MS = 24 * 60 * 60_000

export async function sweepStrandedRunTemporaries(
  directory: string,
  now: number,
  pidLiveness: (pid: number) => ProcessLiveness = getPidLiveness,
): Promise<void> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const temporary = /\.json\.tmp-(?:(\d+)-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.exec(entry.name)
    if (temporary === null) continue
    const path = join(directory, entry.name)
    try {
      if ((await stat(path)).mtimeMs > now - STRANDED_TEMP_MIN_AGE_MS) continue
      if (temporary[1] !== undefined && pidLiveness(Number(temporary[1])) !== "dead") continue
      await unlinkRunArtifact(path)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
