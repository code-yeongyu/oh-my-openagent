import { describe, expect, it } from "bun:test"

import packageJson from "../../package.json" with { type: "json" }
import { getProductVersion } from "./product-identity"

describe("getProductVersion", () => {
  it("returns the omo-codex package version from the single source of truth", () => {
    // when
    const version = getProductVersion()

    // then
    expect(version).toBe(packageJson.version)
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })
})
