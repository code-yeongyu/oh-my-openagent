import { describe, expect, test } from "bun:test"
import { listLiveDevices } from "./devices"

describe("listLiveDevices", () => {
  test("#given a list with a revoked device #when read #then only live devices return, with the bearer of this sign-in", async () => {
    const seen: unknown[] = []
    const devices = await listLiveDevices({
      accessToken: async () => "access-fixture",
      request: async (path, init) => {
        seen.push({ path, authorization: new Headers(init.headers).get("authorization") })
        return {
          devices: [
            { id: "a", name: "device-a", current: true, revokedAt: null, lastSeenAt: "2026-11-19T00:00:00Z" },
            { id: "b", name: "device-b", revokedAt: "2026-11-18T00:00:00Z" },
          ],
        }
      },
    })
    expect(devices).toEqual([{ id: "a", name: "device-a", lastSeenAt: "2026-11-19T00:00:00Z", current: true }])
    expect(seen).toEqual([{ path: "/v1/devices", authorization: "Bearer access-fixture" }])
  })

  test("#given a body without a device list #when read #then it throws instead of answering an empty list", async () => {
    const reading = listLiveDevices({ accessToken: async () => "x", request: async () => ({}) })
    await expect(reading).rejects.toThrow()
  })
})
