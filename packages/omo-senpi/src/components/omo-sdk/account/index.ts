import { syncRequestHeaders } from "@oh-my-opencode/memory-core/sync-capabilities"
import { type LiveDevice, listLiveDevices } from "@oh-my-opencode/omo-opencode/service-auth"
import { z } from "zod"
import type { AccountAccess } from "../access"
import { type OmoResult, refused } from "../result"
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
  /**
   * The account's devices as the account service lists them, revoked ones left out and this device `current`: the
   * account view, which alone carries `createdAt`, `machineBound` and `syncing` (`devices.list` is the device service's).
   */
  readonly devices: () => Promise<OmoResult<readonly LiveDevice[]>>
  /** Signs this machine in by device code; the caller shows the code from `onUserCode` to a person who approves it. */
  readonly signIn: (options: SignInOptions) => Promise<OmoResult<SignedIn>>
}

const meSchema = z.object({
  user: z
    .object({ email: z.string().min(1) })
    .partial()
    .optional(),
  account: z
    .object({ id: z.string().min(1) })
    .partial()
    .optional(),
})

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
    devices: () => access.signedIn(({ session }) => listLiveDevices(session)),
    whoami: () =>
      access.signedIn(async ({ device, session }) => {
        const body = await session.request("/v1/me", { headers: syncRequestHeaders(await session.accessToken()) })
        const me = meSchema.safeParse(body)
        const email = me.success ? me.data.user?.email : undefined
        const accountId = me.success ? me.data.account?.id : undefined
        return {
          api: access.origin,
          device,
          ...(email === undefined ? {} : { email }),
          ...(accountId === undefined ? {} : { accountId }),
        }
      }),
  }
}
