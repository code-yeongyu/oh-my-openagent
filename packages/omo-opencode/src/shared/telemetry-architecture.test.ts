/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  DEFAULT_POSTHOG_API_KEY,
  type TelemetryProductConfig,
} from "@oh-my-opencode/telemetry-core"
import { createOpencodeTelemetryProductConfig } from "./telemetry-product-identity"

const REPO_ROOT = join(import.meta.dir, "../../..", "..")
const TELEMETRY_CORE_PACKAGE = "@oh-my-opencode/telemetry-core"

function readText(path: string): string {
  return readFileSync(path, "utf-8")
}

describe("omo-opencode telemetry architecture", () => {
  it("uses telemetry-core as the PostHog implementation boundary", () => {
    // given
    const posthogSource = readText(join(REPO_ROOT, "packages", "omo-opencode", "src", "shared", "posthog.ts"))

    // when / then
    expect(posthogSource).toContain(TELEMETRY_CORE_PACKAGE)
    expect(posthogSource).toContain("createTelemetryClient")
    expect(posthogSource).not.toContain("recordDailyActive")
  })

  it("exports a valid product config with the shared PostHog key", () => {
    // given
    const product = createOpencodeTelemetryProductConfig()

    // when
    const typedProduct = product satisfies TelemetryProductConfig

    // then
    expect(typedProduct.defaultApiKey).toBe(DEFAULT_POSTHOG_API_KEY)
    expect(typedProduct.eventName).toBe("omo_daily_active")
    expect(typedProduct.additionalProperties).toMatchObject({
      plugin_name: "oh-my-openagent",
    })
  })
})
