import { describe, expect, test } from "bun:test"

// Public API contract of the shipped bundle: eval cells import it from `${OMO_SDK_ROOT}/sdk.js`, which the plugin
// manifest also maps as `#omo-sdk`.
describe("omo SDK bundle", () => {
  test("#given the committed bundle #when imported through the plugin import map #then createOmoSdk answers typed reads", async () => {
    const sdk = await import("#omo-sdk")
    expect(Object.keys(sdk).sort()).toEqual(["SDK_VERSION", "createOmoSdk"])
    expect(sdk.SDK_VERSION).not.toBe("dev")
    const omo = sdk.createOmoSdk({ ports: { desktopLaunch: () => false, credentialStore: { read: async () => null } } })
    const devices = await omo.devices.list()
    expect(devices.kind === "error" ? devices.error.code : devices.kind).toBe("signed_out")
  })
})
