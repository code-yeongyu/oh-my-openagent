import type { RemoteClient } from "../../remote/client"
import type { RemoteFailure } from "../../remote/types"
import type { RemoteDevice } from "./ports"

/** A remote client member that settled with a failure, thrown where the thread callers read the account (a caught read). */
export class AccountReadFailure extends Error {
  readonly failure: RemoteFailure
  constructor(failure: RemoteFailure) {
    super(failure.message)
    this.failure = failure
  }
}

/** This device's account id (null with no device service id) and the account's devices, from ONE `devices.list` round. */
export type AccountDevices = { readonly here: string | null; readonly devices: readonly RemoteDevice[] }

/**
 * The account as the thread tools read it, through the one remote client (#13414 4c): the device list names this device
 * on its self row, so "which device am I" and "is that device online" cost one round, never a `thisDevice` plus a
 * `devices` read. A client with no device service lists only its local self row: no id, no other device.
 */
export async function accountDevices(client: RemoteClient): Promise<AccountDevices> {
  const listed = await client.devices.list()
  if (listed.kind === "error") throw new AccountReadFailure(listed)
  const self = listed.value.find((row) => row.self === true)
  const here = self === undefined || self.kind === "local" ? null : self.id
  return {
    here,
    devices: listed.value
      .filter((row) => row.kind !== "local")
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
