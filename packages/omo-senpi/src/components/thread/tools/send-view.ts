import type { AddressBookHost } from "../address-book"
import type { ThreadHostView, ThreadToolSurfaceOptions } from "./ports"

/** The published owner a send listed alone: the thread it published and its own socket's answer. */
export type ListedOwner = { readonly thread: string; readonly host: AddressBookHost }

/**
 * A published durable id never needs enumeration. The fresh endpoint listing is filtered to
 * that identity; normal address resolution still enforces workspace scope before enqueue.
 * Only a missing metadata row uses the pre-publication discovery path. `owner` is set when the
 * view lists the owner's socket alone, so a caller can read that socket's answer for the thread.
 */
export async function sendView(
  options: ThreadToolSurfaceOptions,
  address: string,
  legacy: () => Promise<ThreadHostView>,
): Promise<{ readonly view: ThreadHostView; readonly owner?: ListedOwner }> {
  const owner = await options.store.sessionOwner(address)
  if (owner === null) return { view: await legacy() }
  if (owner.endpoint === null || options.host.listTarget === undefined)
    return { view: { sessions: [], hosts: [], disk: [] } }
  const view = await options.host.listTarget(address, owner.endpoint)
  const [host] = view.hosts
  return { view, ...(host === undefined ? {} : { owner: { thread: address, host } }) }
}
