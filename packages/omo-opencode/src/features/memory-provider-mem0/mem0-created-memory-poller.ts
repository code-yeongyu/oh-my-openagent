import { Mem0L2AdapterError } from "./errors"
import type { Mem0Client } from "./types"

export async function pollForCreatedMem0Memory(client: Mem0Client, userId: string): Promise<string> {
  const pollBackoffs = [2000, 3000, 5000, 8000]
  for (const backoff of pollBackoffs) {
    await new Promise<void>(resolve => setTimeout(resolve, backoff))
    const all = await client.getAll({ user_id: userId })
    if (all.length === 0) continue

    const latest = all.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))[0]
    if (latest && typeof latest.id === "string") {
      return latest.id
    }
  }

  throw new Mem0L2AdapterError("Mem0 add completed but could not resolve memory ID after polling")
}
