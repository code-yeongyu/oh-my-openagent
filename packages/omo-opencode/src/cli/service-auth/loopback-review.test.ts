import { expect, onTestFinished, spyOn, test } from "bun:test"
import { Server } from "node:http"
import { loginLoopback } from "./loopback"
import { createSession } from "./session"
import { fakeApi, grant, memorySecrets, temporaryHome } from "./test-support"

for (const property of ["bind-address", "ephemeral-port", "single-use", "state-mismatch-position"]) {
  test(`real loopback callback enforces ${property}`, async () => {
    const api = fakeApi(() => Response.json(grant))
    const listen = spyOn(Server.prototype, "listen")
    const address = spyOn(Server.prototype, "address")
    onTestFinished(() => { listen.mockRestore(); address.mockRestore() })
    await loginLoopback(createSession({ api, store: memorySecrets().store(api), home: await temporaryHome() }), {
      accounts: "https://accounts.omo.dev", name: "Test", platform: "linux", chooseDevice: async () => null,
      open: async url => {
        const ask = new URL(url)
        const callback = new URL(ask.searchParams.get("redirect_uri") ?? "")
        if (property === "bind-address") {
          expect(address.mock.results.some(result => result.type === "return" && typeof result.value === "object" &&
            result.value !== null && result.value.address === "127.0.0.1")).toBe(true)
        }
        if (property === "ephemeral-port") {
          expect(listen).toHaveBeenCalledWith(0, "127.0.0.1", expect.any(Function))
          expect(Number(callback.port)).toBeGreaterThan(0)
        }
        callback.searchParams.set("code", "one-use-code")
        callback.searchParams.set("state", "short")
        expect((await fetch(callback)).status).toBe(400)
        if (property === "state-mismatch-position") {
          const state = ask.searchParams.get("state") ?? ""
          const first = `${state[0] === "A" ? "B" : "A"}${state.slice(1)}`
          const last = `${state.slice(0, -1)}${state.at(-1) === "A" ? "B" : "A"}`
          for (const mismatch of [first, last, `${state}A`]) {
            callback.searchParams.set("state", mismatch)
            expect((await fetch(callback)).status).toBe(400)
          }
        }
        callback.searchParams.set("state", ask.searchParams.get("state") ?? "")
        expect((await fetch(callback)).status).toBe(200)
        if (property === "single-use") expect((await fetch(callback)).status).toBe(400)
        return true
      },
    })
  })
}

for (const accounts of ["http://example.com", "javascript:alert(1)", "file:///tmp/test", "http://localhost:8080"]) {
  test(`loopback rejects unsafe accounts override ${accounts}`, async () => {
    const api = fakeApi(() => Response.json(grant))
    let opened = false
    await expect(loginLoopback(createSession({ api, store: memorySecrets().store(api), home: await temporaryHome() }), {
      accounts, name: "Test", platform: "linux", chooseDevice: async () => null,
      open: async () => { opened = true; return false },
    })).rejects.toThrow()
    expect(opened).toBe(false)
  })
}
