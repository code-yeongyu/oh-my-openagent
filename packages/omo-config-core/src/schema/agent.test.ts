import { describe, expect, test } from "bun:test"

import { OmoAgentDefSchema } from "./agent"

describe("OmoAgentDefSchema", () => {
  test("#given depth beyond shared cap #when parsed #then rejects it", () => {
    expect(OmoAgentDefSchema.safeParse({ max_depth: 3 }).success).toBe(false)
  })
})
