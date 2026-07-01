import { describe, expect, it } from "bun:test"
import packageJson from "../../../../package.json" with { type: "json" }
import { PLUGIN_NAME } from "./plugin-identity"
import { createOpencodeTelemetryProductConfig } from "./telemetry-product-identity"

describe("createOpencodeTelemetryProductConfig", () => {
  it("pins the omo-opencode telemetry identity for zero data breakage", () => {
    // given
    const expectedVersion = packageJson.version

    // when
    const product = createOpencodeTelemetryProductConfig()

    // then
    expect(product).toMatchObject({
      cacheDirName: "oh-my-opencode",
      eventName: "omo_daily_active",
      machineIdPrefix: "oh-my-openagent:",
      packageName: "oh-my-openagent",
      packageVersion: expectedVersion,
      platform: "oh-my-opencode",
      productEnvPrefix: "OMO",
      productName: "oh-my-openagent",
      additionalProperties: {
        plugin_name: PLUGIN_NAME,
      },
    })
  })
})
