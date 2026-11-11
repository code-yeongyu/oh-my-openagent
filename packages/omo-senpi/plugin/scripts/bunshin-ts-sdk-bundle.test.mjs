import { describe, expect, test } from "bun:test"

// Public API contract of the shipped bundle: eval cells import these names from `${OMO_BUNSHIN_TS_SDK_ROOT}/sdk.js`,
// which the plugin manifest also maps as `#bunshin-ts`.
describe("bunshin-ts SDK bundle", () => {
  test("#given the built bundle #when imported through the plugin import map #then it exposes the eval cell API", async () => {
    const sdk = await import("#bunshin-ts")
    const names = Object.keys(sdk)
    for (const name of [
      "bunshin",
      "connect",
      "createRelayTransport",
      "relayStatus",
      "RelayTransportError",
      "pickTransport",
      "BunshinSessionError",
      "FanoutRun",
      "SDK_VERSION",
    ]) {
      expect(names).toContain(name)
    }
    expect(typeof sdk.bunshin.listMachines).toBe("function")
    expect(sdk.SDK_VERSION).not.toBe("dev")
  })
})
