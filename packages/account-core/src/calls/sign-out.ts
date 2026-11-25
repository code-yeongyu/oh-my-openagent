import type { Session } from "../session"

// account.signOut (first-party design 6.4): revoke this machine's device and remove the stored credential and device
// keys. `revoked` is whether the account service confirmed the revoke; the local sign-out happens either way.

export type SignedOut = { readonly signedOut: true; readonly revoked: boolean }

export async function accountSignOut(deps: { readonly session: Pick<Session, "logout"> }): Promise<SignedOut> {
  return { signedOut: true, revoked: await deps.session.logout() }
}

/** account.signInCheck: a probe that the sign-in call exists; it touches nothing. */
export const accountSignInCheck = (): { readonly ready: true } => ({ ready: true })
