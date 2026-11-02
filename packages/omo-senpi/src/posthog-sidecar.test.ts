import { expect, it } from "bun:test"
import { readFileSync } from "node:fs"

it("keeps the PostHog SDK outside the main extension bundle", () => {
  // Given the published extension, when inspecting the eager code, then no SDK ships there.
  const main = readFileSync(new URL("../plugin/extensions/omo.js", import.meta.url), "utf8")
  expect(main).not.toContain("PostHogTelemetryTransport")
  expect(main).not.toContain("posthog-node")
  expect(main).toContain('import("#omo-telemetry-posthog-runtime")')
})
