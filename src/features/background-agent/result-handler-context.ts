import type { ConcurrencyManager } from "./concurrency"
import type { OpencodeClient } from "./constants"
import type { TaskStateManager } from "./state"

export interface ResultHandlerContext {
  client: OpencodeClient
  concurrencyManager: ConcurrencyManager
  state: TaskStateManager
}
