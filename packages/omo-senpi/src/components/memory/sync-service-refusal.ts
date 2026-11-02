import type { SyncRpcProblem, SyncServiceCode } from "./sync-rpc-contract"

const REFUSAL_COPY = {
  not_available: "Memory sync isn't available yet. Your memory stays on this device until it launches.",
  entitlement_required: "Memory sync isn't included in this account's plan.",
  access_not_open: "OmO isn't open to this account yet.",
  device_revoked: "This device was removed from your account. Sign in again to sync.",
  reauth_required: "Your sign-in has expired. Sign in again to sync.",
  account_deleted: "This account was deleted.",
  client_update_required: "Update OmO to keep syncing.",
} as const satisfies Readonly<Record<SyncServiceCode, string>>

/**
 * A 4xx sync refusal as the client may see it: a code from the service contract's closed list maps
 * to our own copy, and anything else stays the generic refusal. The service's message text never
 * crosses the RPC boundary (#12123); its two alias names for a client update collapse into one code.
 */
export function serviceRefusal(serviceCode: string): Extract<SyncRpcProblem, { readonly kind: "refused" }> {
  const name =
    serviceCode === "client_upgrade_required" || serviceCode === "update_required" ? "client_update_required" : serviceCode
  if (!Object.hasOwn(REFUSAL_COPY, name)) return { kind: "refused", reason: "The service refused this sync request." }
  const code = name as SyncServiceCode
  return { kind: "refused", reason: REFUSAL_COPY[code], code }
}
