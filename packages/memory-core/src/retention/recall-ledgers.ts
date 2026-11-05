import { join } from "node:path"

import { lstat, rm } from "../fs/resilient"
import { DAY_MS, StoreTally, listNames, type RetentionContext, type RetentionStoreResult } from "./policy"

/** Per-session recall ledgers (design 2.5): a resumed session starts with an empty surfaced set. */
export async function pruneRecallLedgers(context: RetentionContext): Promise<RetentionStoreResult> {
  const tally = new StoreTally()
  const cutoff = context.now() - context.policy.completionsDays * DAY_MS
  for (const name of await listNames(context.paths.recallLedger)) {
    if (!name.endsWith(".json")) continue
    if (context.budget?.skip("ledgers", name) === true) continue
    if (context.budget?.admit("ledgers") === false) break
    const sessionId = name.slice(0, -".json".length)
    const path = join(context.paths.recallLedger, name)
    const stats = await lstat(path).catch(() => undefined)
    if (stats === undefined || !stats.isFile()) continue
    if (context.isLiveSession?.(sessionId) === true) tally.keep(sessionId, "live")
    else if (stats.mtimeMs > cutoff) tally.keep(sessionId, "recent")
    else {
      await rm(path, { force: true })
      tally.removed.push(sessionId)
    }
    context.budget?.done("ledgers", name)
  }
  return tally.result()
}
