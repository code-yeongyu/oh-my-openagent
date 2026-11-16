import type { DeviceService } from "@oh-my-opencode/device-service-core/device-service"
import type { RemoteClient } from "./client"

// Inside the remote module only (never on RemoteClient): the thread runtime builds its port on the client's one shared
// device-service connection, so an engine holds ONE connection and the client's close() ends it (#13768 L3).
const lenders = new WeakMap<RemoteClient, () => Promise<DeviceService>>()

export function lendConnection(client: RemoteClient, open: () => Promise<DeviceService>): void {
  lenders.set(client, open)
}

/** The client's shared connection, opened (or reused) through the client's own connect path; throws when it cannot. */
export async function connectionOf(client: RemoteClient): Promise<DeviceService> {
  const open = lenders.get(client)
  if (open === undefined) throw new Error("This remote client lends no device-service connection.")
  return await open()
}
