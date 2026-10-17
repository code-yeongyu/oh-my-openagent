/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

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

})
