import { describe, expect, test } from "bun:test"
import { signInByRoute } from "./login-routes"
import { createSession } from "./session"
import { clock, fakeApi, grant, memorySecrets, minted, refusal, temporaryHome } from "./test-support"

const earlier = { deviceId: "dev-earlier", deviceName: "Old Laptop" }

async function approveInBrowser(url: string): Promise<boolean> {
  const authorize = new URL(url)
  const callback = new URL(authorize.searchParams.get("redirect_uri") ?? "")
  callback.searchParams.set("code", "one-use-code")
  callback.searchParams.set("state", authorize.searchParams.get("state") ?? "")
  expect((await fetch(callback, { proxy: "" })).status).toBe(200)
  return true
}

// #14032: the browser exchange answers machine_exists; the device-code replace sign-in then answers with the grant.
async function browserRefusedRun(accept: boolean) {
  const secrets = memorySecrets()
  const calls: string[] = []
  const codeBodies: unknown[] = []
  const api = fakeApi(async (request) => {
    const path = new URL(request.url).pathname
    calls.push(path)
    if (path === "/v1/session/exchange") return refusal("machine_exists", earlier, 409)
    if (path === "/v1/device/code") {
      codeBodies.push(await request.json())
      return Response.json(minted)
    }
    return Response.json({ ...grant, replacedDeviceId: earlier.deviceId })
  })
  const offered: unknown[] = []
  const login = signInByRoute(
    createSession({
      beforeKeysDiscarded: async () => undefined,
      api,
      store: secrets.store(api),
      home: await temporaryHome(),
    }),
    {
      loopback: {
        accounts: "https://signin.omo.dev",
        name: "Test CLI",
        platform: "linux",
        open: approveInBrowser,
        chooseDevice: async () => null,
      },
      device: {
        name: "Test CLI",
        platform: "linux",
        ...clock(),
        show: () => {},
        chooseDevice: async () => null,
        replaceDevice: async (existing) => {
          offered.push(existing)
          return accept
        },
      },
    },
  )
  return { api, login, secrets, calls, codeBodies, offered }
}

describe("browser sign-in refused with machine_exists", () => {
  test("an accepted replacement continues as a device-code replace sign-in, and the stored credential omits replacedDeviceId", async () => {
    const run = await browserRefusedRun(true)
    expect(await run.login).toEqual({ replacedDeviceId: earlier.deviceId })
    expect(run.offered).toEqual([earlier])
    expect(run.calls).toEqual(["/v1/session/exchange", "/v1/device/code", "/v1/device/token"])
    expect(run.codeBodies).toEqual([
      { client: { name: "Test CLI", platform: "linux" }, replace: { deviceId: earlier.deviceId } },
    ])
    const saved = await run.secrets.store(run.api).read()
    expect(saved?.accessToken).toBe(grant.accessToken)
    expect(saved).not.toHaveProperty("replacedDeviceId")
  })

  test("a declined replacement keeps the refusal without a device code or a save", async () => {
    const run = await browserRefusedRun(false)
    await expect(run.login).rejects.toThrow("This computer already has an OmO device")
    expect(run.calls).toEqual(["/v1/session/exchange"])
    expect(run.secrets.writes).toHaveLength(0)
  })
})
