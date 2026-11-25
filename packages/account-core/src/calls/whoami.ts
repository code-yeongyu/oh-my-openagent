import { syncRequestHeaders } from "@oh-my-opencode/memory-core/sync-capabilities"
import { signInHint } from "../accounts-gate"
import type { CredentialStore } from "../keystore"
import type { Session } from "../session"
import { type CallOutcome, ok, refusedWith } from "./outcome"

// account.whoami (first-party design 6.4): this device from the store, then the account it is signed in to, read once
// from the account service. The account read's own outcome comes back with the device: the SDK answers a failed read
// as its failure, and `omo whoami` prints the device without the email, each as before.

export type AccountRead =
  | { readonly kind: "read"; readonly email?: string; readonly accountId?: string }
  | { readonly kind: "unread"; readonly error: unknown }

export type WhoAmIRead = {
  readonly device: { readonly id: string; readonly name: string }
  readonly account: AccountRead
}

export type WhoAmIDependencies = {
  readonly store: Pick<CredentialStore, "read">
  readonly session: Pick<Session, "accessToken" | "request">
}

/** What `omo whoami` says when this device has no sign-in: the session's own words for it. */
export const notSignedInMessage = (): string => `Not signed in. ${signInHint("first")}`

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined)
const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined

export async function accountWhoami(
  deps: WhoAmIDependencies,
): Promise<CallOutcome<WhoAmIRead, { readonly code: "signed_out" }>> {
  const stored = await deps.store.read()
  if (stored === null) return refusedWith({ code: "signed_out" })
  const device = { id: stored.device.id, name: stored.device.name }
  const access = await deps.session.accessToken()
  let body: unknown
  try {
    body = await deps.session.request("/v1/me", { headers: syncRequestHeaders(access) })
  } catch (error) {
    return ok({ device, account: { kind: "unread", error } })
  }
  const email = text(field(field(body, "user"), "email"))
  const accountId = text(field(field(body, "account"), "id"))
  return ok({
    device,
    account: {
      kind: "read",
      ...(email === undefined ? {} : { email }),
      ...(accountId === undefined ? {} : { accountId }),
    },
  })
}
