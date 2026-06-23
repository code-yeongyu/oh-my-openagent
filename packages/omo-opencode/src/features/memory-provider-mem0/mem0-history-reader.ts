import type { L2HistoryEntry } from "../memory-provider-core/types"
import type { Mem0Client } from "./types"

export async function readMem0History(
  client: Mem0Client,
  providerExternalId: string,
): Promise<L2HistoryEntry[]> {
  const result = await client.history(providerExternalId)
  return (result ?? []).map(entry => ({
    provider_external_id: providerExternalId,
    previous_value: entry.previous_value ?? "",
    new_value: entry.new_value ?? "",
    action: entry.event ?? "UPDATE",
    changed_at: entry.created_at ?? new Date().toISOString(),
  }))
}
