import { registerStoreIndex, StoreIndexUnavailableError, taskStoreIndexPath } from "@oh-my-opencode/senpi-task"
import { log } from "@oh-my-opencode/utils"

/**
 * The host runner's admission precondition (`admitChildStore`), for the callers that would ensure a
 * host BEFORE the runner runs: the pre-warm and an `auto` spawn's first gate ask. The store is
 * durably in the agent-dir store index, or nothing is ensured. False = the index cannot take it;
 * the spawn then reports its own `store_index_unavailable`.
 */
export async function admitTaskStore(agentDir: string, storeDir: string, context: string): Promise<boolean> {
  try {
    await registerStoreIndex({ indexPath: taskStoreIndexPath(agentDir), storeDir, now: Date.now })
    return true
  } catch (error) {
    if (!(error instanceof StoreIndexUnavailableError)) throw error
    log(`omo-senpi task ${context} skipped: the task store index is unavailable`, { error: error.message })
    return false
  }
}
