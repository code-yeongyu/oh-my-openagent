import { expect, test } from "bun:test"
import { BrowserUnavailable, loginLoopback } from "./loopback"
import { createSession } from "./session"
import { fakeApi, grant, memorySecrets, temporaryHome } from "./test-support"

for (const result of ["false", "reject"]) {
  test(`a valid loopback callback survives opener ${result}`, async () => {
    let exchanges = 0
    const api = fakeApi(() => { exchanges++; return Response.json(grant) })
    const store = memorySecrets().store(api)
    await loginLoopback(createSession({ api, store, home: await temporaryHome() }), {
      accounts: "https://accounts.omo.dev", name: "Test", platform: "linux", chooseDevice: async () => null,
      open: async url => {
        const ask = new URL(url)
        const callback = new URL(ask.searchParams.get("redirect_uri") ?? "")
        callback.searchParams.set("state", ask.searchParams.get("state") ?? "")
        callback.searchParams.set("code", "one-use-code")
        expect((await fetch(callback)).status).toBe(200)
        if (result === "reject") throw new Error("opener exited unsuccessfully")
        return false
      },
    })
    expect(exchanges).toBe(1)
    expect((await store.read())?.refreshToken).toBe(grant.refreshToken)
  })
  test(`opener ${result} without a callback still allows device fallback`, async () => {
    const api = fakeApi(() => Response.json(grant))
    await expect(loginLoopback(createSession({ api, store: memorySecrets().store(api), home: await temporaryHome() }), {
      accounts: "https://accounts.omo.dev", name: "Test", platform: "linux", chooseDevice: async () => null,
      open: async () => {
        if (result === "reject") throw new Error("opener unavailable")
        return false
      },
    })).rejects.toBeInstanceOf(BrowserUnavailable)
  })
}
