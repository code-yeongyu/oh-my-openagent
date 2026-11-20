import type { DeviceService } from "@oh-my-opencode/device-service-core/device-service"
import type { RemoteClient } from "./client"

// Inside the remote module only (never on RemoteClient): the thread runtime builds its port on the client's one shared
// device-service connection, so an engine holds ONE long-lived connection and the client's close() ends it (#13768 L3).
// Endpoint commands (open_session) still ride a fresh owned connection per call, as every borrower's do (#12777).
type Lender = { readonly shared: () => Promise<DeviceService>; readonly dial: () => Promise<DeviceService> }
const lenders = new WeakMap<RemoteClient, Lender>()

export function lendConnection(client: RemoteClient, lender: Lender): void {
  lenders.set(client, lender)
}

const lenderOf = (client: RemoteClient): Lender => {
  const lender = lenders.get(client)
  if (lender === undefined) throw new Error("This remote client lends no device-service connection.")
  return lender
}

/** The client's shared connection, opened (or reused) through the client's own connect path; throws when it cannot. */
export const connectionOf = async (client: RemoteClient): Promise<DeviceService> => await lenderOf(client).shared()

/** A fresh connection the caller owns (and closes), dialed the way the client dials. */
export const dialOf = async (client: RemoteClient): Promise<DeviceService> => await lenderOf(client).dial()
