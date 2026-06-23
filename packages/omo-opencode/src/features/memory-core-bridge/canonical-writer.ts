import type { MemoryCoreService } from "../memory-core/service"
import type { CanonicalMemory } from "../memory-core/types"
import type { MemoryTarget, MemoryWorkItem } from "../claude-tasks/memory-work-item"
import { projectWorkItemToCanonical } from "./work-item-projection"

export interface CanonicalWriterDeps {
  service: MemoryCoreService
  actor: string
  generateMemoryId: () => string
  obsidianEnabled: boolean
  activeProviders?: ReadonlySet<string>
  log?: (message: string, ...args: unknown[]) => void
}

export interface CanonicalWriteInput {
  workItem: MemoryWorkItem
  targets: MemoryTarget[]
}

export interface CanonicalWriteResult {
  memory: CanonicalMemory
  outboxIds: string[]
}

export async function writeCanonicalWithOutbox(
  deps: CanonicalWriterDeps,
  input: CanonicalWriteInput,
): Promise<CanonicalWriteResult> {
  const { canonical, outbox } = projectWorkItemToCanonical({
    workItem: input.workItem,
    targets: input.targets,
    obsidianEnabled: deps.obsidianEnabled,
    memoryId: deps.generateMemoryId(),
    actor: deps.actor,
    activeProviders: deps.activeProviders,
  })

  const memory = await deps.service.create(canonical)
  const outboxIds: string[] = []
  for (const entry of outbox) {
    try {
      await deps.service.enqueueOutbox(entry)
      outboxIds.push(entry.outbox_id)
    } catch (error) {
      deps.log?.("[memory-core-bridge] outbox enqueue failed", {
        outboxId: entry.outbox_id,
        error,
      })
    }
  }

  try {
    await deps.service.appendAuditLog({
      audit_id: `${memory.memory_id}:created`,
      memory_id: memory.memory_id,
      action: "created",
      actor: deps.actor,
      details: {
        work_item_id: input.workItem.id,
        source: input.workItem.source,
        targets: input.targets,
        obsidian_enabled: deps.obsidianEnabled,
      },
    })
  } catch (error) {
    deps.log?.("[memory-core-bridge] audit log append failed", {
      memoryId: memory.memory_id,
      error,
    })
  }

  return { memory, outboxIds }
}
