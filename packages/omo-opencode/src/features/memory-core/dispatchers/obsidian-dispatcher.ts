import type { MemoryCoreService } from "../service"
import type { OutboxDispatcher } from "../outbox-worker"
import type { OutboxEntry } from "../types"
import { syncMemoryToObsidian } from "../../memory-obsidian-sync/sync-worker"

export interface ObsidianDispatcherDeps {
  service: MemoryCoreService
  vaultPath: string
  log?: (message: string, ...args: unknown[]) => void
}

export function createObsidianDispatcher(deps: ObsidianDispatcherDeps): OutboxDispatcher {
  return {
    async dispatch(entry: OutboxEntry): Promise<void> {
      if (entry.provider_name !== "obsidian") return

      const memory = await deps.service.get(entry.memory_id)
      if (!memory) {
        throw new Error(`memory not found for outbox entry ${entry.outbox_id}`)
      }

      const syncState = await deps.service.getSyncState(memory.memory_id, "obsidian")
      const result = await syncMemoryToObsidian(
        memory,
        deps.vaultPath,
        syncState?.last_projected_sha256,
      )

      if (result.error) {
        throw new Error(result.error)
      }

      if (result.written && result.new_hash) {
        await deps.service.updateSyncState({
          memory_id: memory.memory_id,
          provider_name: "obsidian",
          last_synced_at: new Date().toISOString(),
          last_projected_sha256: result.new_hash,
          sync_status: "synced",
        })
      }
    },
  }
}
