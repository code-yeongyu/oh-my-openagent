import { describe, expect, it } from "bun:test"

import { getProductVersion } from "./product-identity"

describe("getProductVersion", () => {
  it("returns omo-codex package version", () => {
    // given

    // when
    const version = getProductVersion()

    // then
    expect(version).toBe("0.1.0")
  })
})
