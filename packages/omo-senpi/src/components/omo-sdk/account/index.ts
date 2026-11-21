import { syncRequestHeaders } from "@oh-my-opencode/memory-core/sync-capabilities"
import { z } from "zod"
import type { AccountAccess } from "../access"
import type { OmoResult } from "../result"

export type WhoAmI = {
  readonly api: string
  readonly device: { readonly id: string; readonly name: string }
  readonly email?: string
  readonly accountId?: string
}

export type AccountApi = { readonly whoami: () => Promise<OmoResult<WhoAmI>> }

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

export function createAccountApi(access: AccountAccess): AccountApi {
  return {
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
