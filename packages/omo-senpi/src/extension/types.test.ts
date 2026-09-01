import { describe, expect, test } from "bun:test"

import type { SenpiExtensionAPI } from "./types"

type Assert<T extends true> = T
type _hasAppendEntry = Assert<"appendEntry" extends keyof SenpiExtensionAPI ? true : false>

describe("SenpiExtensionAPI appendEntry", () => {
  test("appendEntry is an optional member of SenpiExtensionAPI", () => {
    const api = {} as SenpiExtensionAPI
    expect(typeof api.appendEntry).toBe("undefined")
  })
})
