import type { SyncRpcProblem, SyncServiceCode } from "./sync-rpc-contract"

const GENERIC_REFUSAL = "The service refused this sync request."

const REFUSAL_COPY: Readonly<Record<SyncServiceCode, string>> = {
  not_available: "Memory sync isn't available yet. Your memory stays on this device until it launches.",
  entitlement_required: "Memory sync isn't included in this account's plan.",
  access_not_open: "OmO isn't open to this account yet.",
  device_revoked: "This device was removed from your account. Sign in again to sync.",
  reauth_required: "Your sign-in has expired. Sign in again to sync.",
  account_deleted: "This account was deleted.",
  client_update_required: "Update OmO to keep syncing.",
}

const SERVICE_CODES: Readonly<Record<string, SyncServiceCode>> = {
  not_available: "not_available",
  entitlement_required: "entitlement_required",
  access_not_open: "access_not_open",
  device_revoked: "device_revoked",
  reauth_required: "reauth_required",
  account_deleted: "account_deleted",
  client_update_required: "client_update_required",
  client_upgrade_required: "client_update_required",
  update_required: "client_update_required",
}

/**
 * A 4xx sync refusal as the client may see it: a code from the service contract's closed list maps
 * to our own copy, and anything else stays the generic refusal. The service's message text never
 * crosses the RPC boundary (#12123).
 */
export function serviceRefusal(serviceCode: string): Extract<SyncRpcProblem, { readonly kind: "refused" }> {
  const code = Object.hasOwn(SERVICE_CODES, serviceCode) ? SERVICE_CODES[serviceCode] : undefined
  return code === undefined ? { kind: "refused", reason: GENERIC_REFUSAL } : { kind: "refused", reason: REFUSAL_COPY[code], code }
}
