import { DeviceSignInRefused } from "../device-flow"
import { CredentialStoreError, KeychainLockedError } from "../keystore"
import { AccountsUnreachable } from "../login-prelude"
import { MachineAlreadySignedIn, MachineCredentialUnreadable } from "../machine-device"
import { ApiRefusal, type ListedDevice, RequestFailure } from "../protocol"

// The refusals of account.signIn (security design 5.4): a closed set of codes with this module's own message and next
// action, because a service or store message can carry a credential. `cause` is the lower layer's error, kept for a
// command that prints its own message to a person (`omo login`); no SDK answer carries it.

export type SignInRefusalCode =
  | "already_signed_in"
  | "approval_expired"
  | "approval_denied"
  | "device_limit"
  | "machine_exists"
  | "accounts_unreachable"
  | "credential_store_locked"
  | "credential_store_unavailable"
  | "internal_error"

export type SignInRefusal = {
  readonly code: SignInRefusalCode
  readonly message: string
  readonly next_action: string
  readonly details?: Readonly<Record<string, unknown>>
  readonly cause: unknown
}

const refusal = (
  code: SignInRefusalCode,
  message: string,
  next_action: string,
  cause: unknown,
  details?: Readonly<Record<string, unknown>>,
): SignInRefusal => ({ code, message, next_action, ...(details === undefined ? {} : { details }), cause })

const view = (devices: readonly ListedDevice[]) => devices.map((device) => ({ id: device.id, name: device.name }))

export function signInRefusal(error: unknown, limitDevices: readonly ListedDevice[] | undefined): SignInRefusal {
  if (error instanceof MachineAlreadySignedIn)
    return refusal("already_signed_in", "this machine already has an OmO sign-in", "use the existing sign-in", error)
  if (error instanceof KeychainLockedError)
    return refusal("credential_store_locked", "the credential store is locked", "unlock it, then sign in again", error)
  if (error instanceof MachineCredentialUnreadable || error instanceof CredentialStoreError)
    return refusal(
      "credential_store_unavailable",
      "the credential store could not be read or written",
      "make the system keychain available, then sign in again",
      error,
    )
  if (error instanceof AccountsUnreachable || error instanceof RequestFailure)
    return refusal(
      "accounts_unreachable",
      "OmO accounts could not be reached",
      "check the connection, then retry",
      error,
    )
  if (error instanceof DeviceSignInRefused) {
    switch (error.code) {
      case "approval_denied":
        return refusal("approval_denied", "the sign-in was denied", "start a new sign-in if that was a mistake", error)
      case "approval_expired":
        return refusal("approval_expired", "the code expired before it was approved", "start a new sign-in", error)
      case "device_limit":
        return refusal(
          "device_limit",
          "the account has reached its device limit",
          "remove a device the account no longer uses, then sign in again",
          error,
          { devices: view(limitDevices ?? []) },
        )
      case "replace_unsupported":
      case "replace_mismatch":
        return refusal(
          "machine_exists",
          "this machine's earlier device was not replaced",
          "start a new sign-in and approve replacing this machine's earlier device",
          error,
          { reason: error.code },
        )
    }
  }
  if (error instanceof ApiRefusal && error.code === "machine_exists")
    return refusal(
      "machine_exists",
      "this machine already has a device on the account",
      "sign in again with replace, or remove that device first",
      error,
      {
        ...(error.machineDevice.deviceId === undefined ? {} : { deviceId: error.machineDevice.deviceId }),
        ...(error.machineDevice.deviceName === undefined ? {} : { deviceName: error.machineDevice.deviceName }),
      },
    )
  if (error instanceof ApiRefusal && (error.status === 429 || error.status >= 500))
    return refusal("accounts_unreachable", "OmO accounts are not answering", "retry in a few minutes", error, {
      status: error.status,
    })
  return refusal("internal_error", "the sign-in failed", "retry; report it if it repeats", error, {
    name: error instanceof Error ? error.name : typeof error,
  })
}
