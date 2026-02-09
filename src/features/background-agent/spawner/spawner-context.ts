import type { BackgroundTask } from "../types"
import type { ConcurrencyManager } from "../concurrency"
import type { OpencodeClient, OnSubagentSessionCreated } from "../constants"

export interface SpawnerContext {
  client: OpencodeClient
  directory: string
  concurrencyManager: ConcurrencyManager
  tmuxEnabled: boolean
  onSubagentSessionCreated?: OnSubagentSessionCreated
  onTaskError: (task: BackgroundTask, error: Error) => void
}
