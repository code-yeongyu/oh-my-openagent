import { type CredentialStore, InvalidCredentialState } from "../keystore"
import type { DeviceServiceHandoff, Session } from "../session"
import { type Audited, audited, type CustodyLog } from "./custody-log"
import { type CallOutcome, ok, refusedWith } from "./outcome"

// account.forget (first-party design 6.4): this device forgets its own sign-in, never another device's (that is
// devices.revoke). With a device id the check and the clear run under the credential lock, so a sign-in that replaced
// the named one in between is never cleared.

export type ForgetDependencies = {
  readonly session: Pick<Session, "forget" | "update" | "discard">
  readonly store: Pick<CredentialStore, "clear">
  readonly deviceService?: Pick<DeviceServiceHandoff, "forget">
  /** The custody log (security design 8.2); the forget never waits on it. */
  readonly custody?: CustodyLog
}

export type ForgetRefusal =
  | { readonly code: "empty_device" }
  | { readonly code: "other_device"; readonly device: { readonly id: string; readonly name: string } }
  /** The stored credential does not parse; `message` is the credential store's own words, which name the recovery. */
  | { readonly code: "unreadable_credential"; readonly message: string }

export type Forgotten = Audited<{ readonly forgotten: true }>

async function forget(
  deps: ForgetDependencies,
  device: string | undefined,
): Promise<CallOutcome<{ readonly forgotten: true }, ForgetRefusal>> {
  if (device === undefined) {
    await deps.session.forget()
    return ok({ forgotten: true })
  }
  try {
    const other = await deps.session.update(async (current) => {
      if (current !== null && current.device.id !== device) return { id: current.device.id, name: current.device.name }
      if (current !== null) await deps.session.discard(current, "forget")
      await deps.store.clear()
      return undefined
    })
    if (other !== undefined) return refusedWith({ code: "other_device", device: other })
  } catch (error) {
    if (!(error instanceof InvalidCredentialState)) throw error
    return refusedWith({ code: "unreadable_credential", message: error.message })
  }
  await deps.deviceService?.forget()
  return ok({ forgotten: true })
}

export async function accountForget(
  deps: ForgetDependencies,
  input: { readonly device?: string },
): Promise<CallOutcome<Forgotten, ForgetRefusal>> {
  return audited(deps.custody, "account.forget", async () =>
    input.device === "" ? refusedWith({ code: "empty_device" as const }) : forget(deps, input.device),
  )
}
