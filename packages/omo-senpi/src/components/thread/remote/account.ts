import type { RemoteClient, RemoteFailure } from "../../remote"
import type { RemoteDevice } from "./ports"

const LOCAL_ONLY = "local"

/** This device's account id (null with no device service id) and the account's devices, from ONE `devices.list` round. */
export type AccountDevices = { readonly here: string | null; readonly devices: readonly RemoteDevice[] }

/**
 * The account as the thread tools read it, through the one remote client (#13414 4c): the device list names this device
 * on its self row, so "which device am I" and "is that device online" cost one round, never a `thisDevice` plus a
 * `devices` read. A client with no device service lists only its local self row: no id, no other device.
 */
export async function accountDevices(client: RemoteClient): Promise<AccountDevices> {
  const listed = await client.devices.list()
  if (listed.kind === "error") throw new Error(listed.message)
  // With no device service the self row is the placeholder id `local`; a service whose device list omits this device
  // still names it, on a self row of kind `local` that carries the account id.
  const self = listed.value.find((row) => row.self === true)
  const here = self === undefined || self.id === LOCAL_ONLY ? null : self.id
  return {
    here,
    devices: listed.value
      .filter((row) => row.id !== LOCAL_ONLY)
      .map((row) => ({ device: row.id, label: row.name, online: row.online })),
  }
}

/**
 * The device service state (`connected`, `plan_required`, ...) and this device's account id from the same status
 * round, so a caller that checks the relay needs no device read to know which device it is on.
 */
export async function accountState(
  client: RemoteClient,
): Promise<{ readonly state: string; readonly here: string | null } | RemoteFailure> {
  const status = await client.service.status()
  return status.kind === "error" ? status : { state: status.value.state, here: status.value.device?.id ?? null }
}
