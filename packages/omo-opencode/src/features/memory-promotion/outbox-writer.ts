import { randomUUID } from "node:crypto"
import type { OutboxEntry } from "../memory-core/types"

export interface OutboxWriterDeps {
  enqueueOutbox(entry: Omit<OutboxEntry, "created_at" | "retry_count">): Promise<void>
}

export async function writeToOutbox(
  input: {
    memory_id: string
    provider_name: string
    operation: "create" | "update" | "delete"
  },
  deps: OutboxWriterDeps,
): Promise<string> {
  const outbox_id = randomUUID()
  const idempotency_key = `${input.memory_id}:${input.provider_name}:${input.operation}:${Date.now()}`

  await deps.enqueueOutbox({
    outbox_id,
    memory_id: input.memory_id,
    provider_name: input.provider_name,
    operation: input.operation,
    idempotency_key,
    status: "pending",
    last_attempted_at: undefined,
    error: undefined,
  })

  return outbox_id
}
