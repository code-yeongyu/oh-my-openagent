import { describe, expect, test } from "bun:test"
import {
  unknownFallbackModelsAfterLiveRefresh,
  validateFallbackModelsAgainstLiveCatalog,
} from "./live-catalog-fallback-validate"

describe("validateFallbackModelsAgainstLiveCatalog", () => {
  test("marks missing ids unknown only after a live refresh", () => {
    const findings = validateFallbackModelsAgainstLiveCatalog(
      ["gateway/alpha", "gateway/stale-alias"],
      { catalogRefreshed: true, knownIds: new Set(["gateway/alpha"]) },
    )
    expect(findings.map((f) => f.status)).toEqual(["ok", "unknown-after-refresh"])
    expect(unknownFallbackModelsAfterLiveRefresh(findings)).toEqual(["gateway/stale-alias"])
  })

  test("does not emit unknown when catalog was not refreshed", () => {
    const findings = validateFallbackModelsAgainstLiveCatalog(["gateway/stale-alias"], {
      catalogRefreshed: false,
      knownIds: new Set(),
    })
    expect(findings[0]?.status).toBe("skipped-stale-catalog")
    expect(unknownFallbackModelsAfterLiveRefresh(findings)).toEqual([])
  })
})
