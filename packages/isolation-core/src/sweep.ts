import { readdir, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { isBackendKind, type IsolationBackend } from "./backend"
import { readOwnerLiveness, type OwnerProbe } from "./owner"
import { processOwnerProbe } from "./process-identity"

export interface SweepOptions {
  readonly backends?: readonly IsolationBackend[]
  readonly probe?: OwnerProbe
  readonly now?: number
}
export interface SweepResult {
  readonly reclaimed: string[]
  readonly kept: string[]
  readonly skipped: { path: string; reason: string }[]
}

export async function sweepStaleIsolations(
  rootDirs: readonly string[],
  options: SweepOptions = {},
): Promise<SweepResult> {
  const result: SweepResult = { reclaimed: [], kept: [], skipped: [] }
  for (const root of new Set(rootDirs)) {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue
      result.skipped.push({ path: root, reason: error instanceof Error ? error.message : String(error) })
      continue
    }
    for (const entry of entries) {
      if (!/^t[0-9a-f]{10}(?:\.creating-\d+|\.retained-[\w-]+)?$/.test(entry.name)) continue
      const path = join(root, entry.name)
      if (!entry.isDirectory()) {
        result.skipped.push({ path, reason: "not a directory" })
        continue
      }
      try {
        const liveness = await readOwnerLiveness(path, options.probe ?? processOwnerProbe, options.now)
        if (liveness !== "dead" && liveness !== "reclaimable") {
          result.kept.push(path)
          continue
        }
        const record: unknown = JSON.parse(await readFile(join(path, ".omo-isolation-backend.json"), "utf8"))
        if (typeof record !== "object" || record === null || !("backend" in record) || !isBackendKind(record.backend)) {
          result.skipped.push({ path, reason: "invalid backend marker" })
          continue
        }
        const backend = options.backends?.find((entry) => entry.kind === record.backend)
        if (!backend) {
          result.skipped.push({ path, reason: `No implementation for ${record.backend}` })
          continue
        }
        await backend.stop(join(path, "m"))
        await rm(path, { recursive: true, force: true })
        result.reclaimed.push(path)
      } catch (error) {
        result.skipped.push({ path, reason: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  return result
}
