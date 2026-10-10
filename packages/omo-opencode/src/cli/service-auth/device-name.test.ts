import { describe, expect, test } from "bun:test"
import { deviceName } from "./device-name"
import { loginDevice } from "./device-flow"
import { createSession } from "./session"
import { clock, fakeApi, grant, memorySecrets, minted, temporaryHome } from "./test-support"

describe("default device name", () => {
  test("strips format characters and Hangul fillers before minting", async () => {
    const name = deviceName("host\u200D\u202E\u00AD\u2060\u{E0001}\u3164\u115F\u1160\uFFA0\n\u2028\u2029")
    expect(name).toBe("omo CLI on host")
    let sent = false
    const api = fakeApi(async request => {
      if (request.url.endsWith("/code")) {
        const body = await request.json()
        expect(body.client.name).toBe(name)
        expect(body.client.name).toMatch(/^(?=.*\S)[^\p{Cc}\p{Zl}\p{Zp}\p{Cf}\u3164\u115F\u1160\uFFA0]{1,64}$/u)
        sent = true
        return Response.json(minted)
      }
      return Response.json(grant)
    })
    await loginDevice(createSession({ api, store: memorySecrets().store(api), home: await temporaryHome() }), {
      name, platform: "linux", ...clock(), show: () => {}, chooseDevice: async () => null,
    })
    expect(sent).toBe(true)
  })

  test.each(["", " \u200D\u3164 ", "a".repeat(100), "😀".repeat(100)])("always yields a nonempty bounded valid name", input => {
    const name = deviceName(input)
    expect(name).toBe(name.trim())
    expect([...name].length).toBeLessThanOrEqual(64)
    expect(name).toMatch(/^(?=.*\S)[^\p{Cc}\p{Zl}\p{Zp}\p{Cf}\u3164\u115F\u1160\uFFA0]{1,64}$/u)
  })
})
