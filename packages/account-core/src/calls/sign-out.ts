import type { Session } from "../session"
import { type Audited, audited, type CustodyLog } from "./custody-log"
import { ok } from "./outcome"

// account.signOut (first-party design 6.4): revoke this machine's device and remove the stored credential and device
// keys. `revoked` is whether the account service confirmed the revoke; the local sign-out happens either way.

export type SignedOut = Audited<{ readonly signedOut: true; readonly revoked: boolean }>

export async function accountSignOut(deps: {
  readonly session: Pick<Session, "logout">
  /** The custody log (security design 8.2); the sign-out never waits on it. */
  readonly custody?: CustodyLog
}): Promise<SignedOut> {
  const outcome = await audited<{ readonly signedOut: true; readonly revoked: boolean }, never>(
    deps.custody,
    "account.signOut",
    undefined,
    async () => ok({ signedOut: true, revoked: await deps.session.logout() }),
  )
  return outcome.value
}

/** account.signInCheck: a probe that the sign-in call exists; it touches nothing. */
export const accountSignInCheck = (): { readonly ready: true } => ({ ready: true })
