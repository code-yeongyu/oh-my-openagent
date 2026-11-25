import { describe, expect, test } from "bun:test"

import { createSession } from "../session"
import { clock, fakeApi, grant, memorySecrets, minted, temporaryHome } from "../test-support"
import { accountSignIn } from "./sign-in"

async function world(options: { readonly onToken?: () => void } = {}) {
  const calls: string[] = []
  const api = fakeApi(async (request) => {
    const path = new URL(request.url).pathname
    calls.push(path)
    if (path === "/v1/health") return Response.json({ ok: true })
    if (path === "/v1/device/code") return Response.json(minted)
    if (path === "/v1/device/token") {
      options.onToken?.()
      return Response.json(grant)
    }
    return new Response("", { status: 404 })
  })
  const controller = new AbortController()
  const store = memorySecrets().store(api)
  const home = await temporaryHome()
  const session = createSession({
    api,
    store,
    home,
    signal: controller.signal,
    beforeKeysDiscarded: async () => undefined,
  })
  return { api, calls, controller, store, session }
}

const run = (
  w: Awaited<ReturnType<typeof world>>,
  extra: { readonly onUserCode?: () => void; readonly setUp?: () => Promise<"on"> } = {},
) =>
  accountSignIn(
    {
      api: w.api,
      session: w.session,
      store: w.store,
      accountsOpen: false,
      ...(extra.setUp === undefined ? {} : { setUpDeviceService: extra.setUp }),
      ...clock(),
    },
    { method: "device_code", onUserCode: extra.onUserCode ?? (() => undefined), signal: w.controller.signal },
  )

describe("account.signIn cancellation", () => {
  test("#given a signal already aborted #then it answers cancelled before any request", async () => {
    const w = await world()
    w.controller.abort()
    expect(await run(w)).toEqual({ kind: "refused", code: "cancelled" })
    expect({ calls: w.calls, stored: await w.store.read() }).toEqual({ calls: [], stored: null })
  })

  test("#given an abort while the code waits for approval #then it answers cancelled and stores nothing", async () => {
    const w = await world()
    const answer = await run(w, { onUserCode: () => w.controller.abort() })
    expect(answer).toEqual({ kind: "refused", code: "cancelled" })
    expect(w.calls).not.toContain("/v1/device/token")
    expect(await w.store.read()).toBeNull()
  })

  test("#given an abort during the device-service setup #then it answers cancelled, the approved sign-in already stored", async () => {
    const w = await world()
    const answer = await run(w, {
      setUp: async () => {
        w.controller.abort()
        return "on"
      },
    })
    expect(answer).toEqual({ kind: "refused", code: "cancelled" })
    expect((await w.store.read())?.device.id).toBe(grant.device.id)
  })
})
