import { compareVersions, MirrorPlanError, shouldMoveChannel } from "./mirror-plan"
import type { R2Store } from "./r2-store"

type ChannelStore = Pick<R2Store, "readText" | "write">

export async function mirrorChannel(
  store: ChannelStore,
  live: ChannelStore,
  key: string,
  version: string,
  dryRun: boolean,
  force: boolean,
  log: (line: string) => void,
): Promise<string> {
  const current = (await live.readText(key))?.trim() ?? null
  const target = dryRun ? store : live
  const move = shouldMoveChannel(current, version, force)
  if (dryRun) {
    log(`dry run: shouldMoveChannel=${move} for ${key}: ${current ?? "(unset)"} -> ${version}; force=${force}`)
    await store.write(key, `${current ?? version}\n`, "text/plain")
  }
  const write = dryRun || move
  if (write) {
    await target.write(key, `${version}\n`, "text/plain")
    log(`${dryRun ? "dry run: wrote scratch" : "moved"} ${key}: ${current ?? "(unset)"} -> ${version}`)
  } else log(`kept ${key} at ${current}; ${version} is older`)
  const pointer = (await target.readText(key))?.trim() ?? ""
  if (write && pointer !== version) {
    if (!dryRun && !force && pointer && compareVersions(pointer, version) >= 0) {
      log(`${key}: accepted newer pointer read-back ${pointer} after writing ${version}`)
    } else throw new MirrorPlanError(`${key}: pointer read-back ${pointer} != ${version}`)
  }
  return pointer
}
