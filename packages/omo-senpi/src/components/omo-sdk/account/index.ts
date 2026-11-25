import { accountWhoami } from "@oh-my-opencode/account-core/calls/whoami"
import { type AccountAccess, failure, SIGN_IN } from "../access"
import { ok, type OmoResult, refused } from "../result"
import { runSignIn, type SignedIn, type SignInOptions } from "./sign-in"
import type { SignInProcess } from "./sign-in-process"

export type { SignedIn, SignInOptions, UserCode } from "./sign-in"
export type { SignInProcess } from "./sign-in-process"

export type WhoAmI = {
  readonly api: string
  readonly device: { readonly id: string; readonly name: string }
  readonly email?: string
  readonly accountId?: string
}

export type AccountApi = {
  readonly whoami: () => Promise<OmoResult<WhoAmI>>
  /** Signs this machine in by device code; the caller shows the code from `onUserCode` to a person who approves it. */
  readonly signIn: (options: SignInOptions) => Promise<OmoResult<SignedIn>>
}

export function createAccountApi(
  access: AccountAccess,
  signIn: { readonly process: SignInProcess | undefined; readonly env: Readonly<Record<string, string | undefined>> },
): AccountApi {
  return {
    signIn: async (options) => {
      const blocked = access.blockedReason()
      if (blocked !== undefined) return blocked
      if (signIn.process === undefined)
        return refused(
          "internal_error",
          "this engine was not started by the omo launcher, so it cannot run a sign-in",
          "sign in from an omo session or the omo launcher",
        )
      return runSignIn(signIn.process, { origin: access.origin, env: signIn.env }, options)
    },
    whoami: async () => {
      const blocked = access.blockedReason()
      if (blocked !== undefined) return blocked
      try {
        const read = await accountWhoami({ store: access.store(), session: access.session() })
        if (read.kind === "refused") return refused("signed_out", "this device is not signed in", SIGN_IN)
        const { device, account } = read.value
        if (account.kind === "unread") return failure(account.error)
        return ok({
          api: access.origin,
          device,
          ...(account.email === undefined ? {} : { email: account.email }),
          ...(account.accountId === undefined ? {} : { accountId: account.accountId }),
        })
      } catch (error) {
        return failure(error)
      }
    },
  }
}
