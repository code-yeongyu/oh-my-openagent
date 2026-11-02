import type { ThreadHostView, ThreadToolSurfaceOptions } from "./ports"

/**
 * A published durable id never needs enumeration. The fresh endpoint listing is filtered to
 * that identity; normal address resolution still enforces workspace scope before enqueue.
 * Only a missing metadata row uses the pre-publication discovery path.
 */
export async function sendView(options: ThreadToolSurfaceOptions, address: string, legacy: () => Promise<ThreadHostView>): Promise<ThreadHostView> {
  const owner = await options.store.sessionOwner(address)
  if (owner === null) return await legacy()
  if (owner.endpoint === null || options.host.listTarget === undefined) return { sessions: [], hosts: [], disk: [] }
  return await options.host.listTarget(address, owner.endpoint)
}
