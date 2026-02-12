import { describe, expect, test } from "bun:test"
import { BuiltinAgentNameSchema, OverridableAgentNameSchema } from "./agent-names"

describe("agent name schemas", () => {
  test("BuiltinAgentNameSchema accepts athena", () => {
    //#given
    const candidate = "athena"

    //#when
    const result = BuiltinAgentNameSchema.safeParse(candidate)

    //#then
    expect(result.success).toBe(true)
  })

  test("OverridableAgentNameSchema accepts athena", () => {
    //#given
    const candidate = "athena"

    //#when
    const result = OverridableAgentNameSchema.safeParse(candidate)

    //#then
    expect(result.success).toBe(true)
  })
})
