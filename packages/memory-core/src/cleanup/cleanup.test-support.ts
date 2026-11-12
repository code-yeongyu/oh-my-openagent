import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { GitMemoryRepo } from "../git"
import { applyMemoryCleanup } from "./apply"
import { planMemoryCleanup } from "./plan"
import type { MemoryCleanupOptions } from "./types"

export const NOW = Date.parse("2026-11-09T12:00:00Z")
export const author = { agentId: "fixture-agent", authorName: "Cleanup" }
export const lock = async <T>(_domain: string, operation: () => Promise<T>): Promise<T> => operation()

export const LESSON = [
  "# Watch the queue before dispatching",
  "Read the host's order-line depth before placing a job; load average counts I/O-blocked threads and is not an idleness oracle.",
  "A grant's success line is not its effect: read the order line back in the same cell.",
  "An empty reply from the grant tool is the host not answering, never a slow grant.",
  "Re-place the jobs of a silent host on one that answers before asking for the grant again.",
  "A P0 line left behind by a stopped job blocks every row below it until it is retired.",
  "Retire a dead line of your own label in the same turn the job stops.",
  "A live line, another lane's line, or a label about to relaunch stays the grantor's call.",
  "Quote the order line unclipped; a cut at eighty columns hides the priority flag.",
].join("\n\n")

export async function run(repo: GitMemoryRepo, options: MemoryCleanupOptions = {}) {
  const plan = await planMemoryCleanup(repo.dir, { now: NOW, ...options })
  const applied = await applyMemoryCleanup({ repo, lock, plan, author })
  return { plan, applied }
}

export const read = (dir: string, path: string): Promise<string> => readFile(join(dir, path), "utf8")
export const exists = (dir: string, path: string): Promise<boolean> =>
  readFile(join(dir, path)).then(
    () => true,
    () => false,
  )
