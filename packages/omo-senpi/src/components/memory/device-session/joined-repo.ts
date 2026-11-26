import type { ComponentLogger } from "../../../extension/types"
import { prepareMemoryEngineSession } from "../engine-session"
import type { SyncSessionRequest } from "../sync-runner"

/**
 * omo#14094 (LEAD ruling, option A with limits): the repository a joined, sync-on device needs before the account's
 * memory can arrive. It goes through the one first-write seam (`prepareMemoryEngineSession`: writer lock, re-checked
 * `.git`, same seed files and hooks), so a concurrent first write and this call create it once, and only the caller
 * that created it logs.
 */
export function joinedDeviceRepoCreator(
  logger: Pick<ComponentLogger, "info">,
): (request: SyncSessionRequest) => Promise<void> {
  return async ({ identity, paths }) => {
    const prepared = await prepareMemoryEngineSession(identity, paths)
    if (prepared.created === true)
      logger.info("memory sync created this device's memory repository so the account's memory can arrive", {
        identity,
      })
  }
}
