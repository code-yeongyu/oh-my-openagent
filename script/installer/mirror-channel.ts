import { compareVersions, MirrorPlanError, shouldMoveChannel } from "./mirror-plan"
import { withRetry } from "./mirror-retry"
import type { R2Store } from "./r2-store"

type ChannelStore = Pick<R2Store, "readText" | "write" | "writeOnce">

export async function mirrorChannel(
  store: ChannelStore,
  live: ChannelStore,
  key: string,
  version: string,
  dryRun: boolean,
  force: boolean,
  log: (line: string) => void,
  retrySleep?: (ms: number) => Promise<unknown>,
): Promise<string> {
  const current = (await live.readText(key))?.trim() ?? null
  const target = dryRun ? store : live
  const move = shouldMoveChannel(current, version, force)
  if (dryRun) {
    log(`dry run: shouldMoveChannel=${move} for ${key}: ${current ?? "(unset)"} -> ${version}; force=${force}`)
    await store.write(key, `${current ?? version}\n`, "text/plain")
  }
  let write = dryRun || move
  if (dryRun) {
    await target.write(key, `${version}\n`, "text/plain")
    log(`dry run: wrote scratch ${key}: ${current ?? "(unset)"} -> ${version}`)
  } else if (move) {
    // A failed PUT may still have committed, and another release may move the pointer before the retry (#11341):
    // every attempt re-reads the live pointer and writes only while this version is still not older than it.
    write = await withRetry(
      `write ${key}`,
      async () => {
        const before = (await live.readText(key))?.trim() ?? null
        if (!shouldMoveChannel(before, version, force)) {
          log(`${key}: ${before} is newer than ${version} before this attempt; not overwriting it`)
          return false
        }
        await live.writeOnce(key, `${version}\n`, "text/plain")
        return true
      },
      retrySleep,
    )
    if (write) log(`moved ${key}: ${current ?? "(unset)"} -> ${version}`)
  } else log(`kept ${key} at ${current}; ${version} is older`)
  const pointer = (await target.readText(key))?.trim() ?? ""
  if (write && pointer !== version) {
    if (!dryRun && !force && pointer && compareVersions(pointer, version) >= 0) {
      log(`${key}: accepted newer pointer read-back ${pointer} after writing ${version}`)
    } else throw new MirrorPlanError(`${key}: pointer read-back ${pointer} != ${version}`)
  }
  return pointer
}
