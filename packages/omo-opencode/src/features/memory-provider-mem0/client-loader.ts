import type { Mem0Client, Mem0ClientConfig } from "./types"
import { Mem0L2AdapterError } from "./errors"

export async function loadMem0Client(config: Mem0ClientConfig): Promise<Mem0Client> {
  let mod: {
    AsyncMemoryClient?: new (cfg: Mem0ClientConfig) => unknown
    MemoryClient?: new (cfg: Mem0ClientConfig) => unknown
  }

  try {
    mod = (await import("mem0ai")) as {
      AsyncMemoryClient?: new (cfg: Mem0ClientConfig) => unknown
      MemoryClient?: new (cfg: Mem0ClientConfig) => unknown
    }
  } catch {
    throw new Mem0L2AdapterError("mem0ai package not found. Run: bun add mem0ai")
  }

  const ClientCtor = mod.AsyncMemoryClient ?? mod.MemoryClient
  if (!ClientCtor) {
    throw new Mem0L2AdapterError(
      "mem0ai package does not export AsyncMemoryClient or MemoryClient",
    )
  }

  const instance = new ClientCtor({
    apiKey: config.apiKey,
    organizationId: config.organizationId,
    projectId: config.projectId,
  })

  return instance as Mem0Client
}
