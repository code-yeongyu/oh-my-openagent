import { type CredentialStore, InvalidCredentialState } from "../keystore"
import type { DeviceServiceHandoff, Session } from "../session"
import { type CallOutcome, ok, refusedWith } from "./outcome"

// account.forget (first-party design 6.4): this device forgets its own sign-in, never another device's (that is
// devices.revoke). With a device id the check and the clear run under the credential lock, so a sign-in that replaced
// the named one in between is never cleared.

export type ForgetDependencies = {
  readonly session: Pick<Session, "forget" | "update" | "discard">
  readonly store: Pick<CredentialStore, "clear">
  readonly deviceService?: Pick<DeviceServiceHandoff, "forget">
}

export type ForgetRefusal =
  | { readonly code: "empty_device" }
  | { readonly code: "other_device"; readonly device: { readonly id: string; readonly name: string } }
  /** The stored credential does not parse; `message` is the credential store's own words, which name the recovery. */
  | { readonly code: "unreadable_credential"; readonly message: string }

export async function accountForget(
  deps: ForgetDependencies,
  input: { readonly device?: string },
): Promise<CallOutcome<{ readonly forgotten: true }, ForgetRefusal>> {
  const { device } = input
  if (device === "") return refusedWith({ code: "empty_device" })
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
