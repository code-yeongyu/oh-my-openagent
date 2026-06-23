import { describe, expect, it } from "bun:test"
import {
  buildSafeFilter,
  filterAnd,
  filterEq,
  filterNot,
  filterOr,
  filterRange,
  validateFilter,
} from "./filter-dsl"

describe("filterEq", () => {
  it("#given field and value #when built #then wraps in AND node", () => {
    const f = filterEq("agent_id", "sisyphus")
    expect(f).toEqual({ AND: [{ field: "agent_id", value: "sisyphus" }] })
  })
})

describe("filterAnd", () => {
  it("#given multiple conditions #when combined #then wraps all in AND", () => {
    const a = filterEq("user_id", "u1")
    const b = filterEq("agent_id", "a1")
    const result = filterAnd(a, b)
    expect(result.AND).toHaveLength(2)
    expect(result.AND?.[0]).toBe(a)
    expect(result.AND?.[1]).toBe(b)
  })
})

describe("filterOr", () => {
  it("#given multiple conditions #when combined #then wraps all in OR", () => {
    const a = filterEq("user_id", "u1")
    const b = filterEq("user_id", "u2")
    const result = filterOr(a, b)
    expect(result.OR).toHaveLength(2)
  })
})

describe("filterNot", () => {
  it("#given a condition #when negated #then wraps in NOT", () => {
    const inner = filterEq("user_id", "u1")
    const result = filterNot(inner)
    expect(result.NOT).toBe(inner)
  })
})

describe("filterRange", () => {
  it("#given gte and lte #when built #then produces two leaves in AND", () => {
    const result = filterRange("created_at", "2024-01-01", "2024-12-31")
    expect(result.AND).toHaveLength(2)
  })

  it("#given only gte #when built #then produces one leaf in AND", () => {
    const result = filterRange("created_at", "2024-01-01")
    expect(result.AND).toHaveLength(1)
  })

  it("#given neither bound #when built #then produces empty AND", () => {
    const result = filterRange("created_at")
    expect(result.AND).toHaveLength(0)
  })
})

describe("validateFilter", () => {
  it("#given filter without user_id #when validated #then invalid", () => {
    const result = validateFilter({ AND: [{ field: "agent_id", value: "a1" }] })
    expect(result.valid).toBe(false)
    expect(result.missingRequired).toBe("user_id")
  })

  it("#given filter with user_id #when validated #then valid", () => {
    const result = validateFilter({ AND: [{ field: "user_id", value: "u1" }] })
    expect(result.valid).toBe(true)
  })
})

describe("buildSafeFilter", () => {
  it("#given user_id only #when built #then contains user_id leaf", () => {
    const result = buildSafeFilter("u1")
    expect(JSON.stringify(result)).toContain("user_id")
    expect(JSON.stringify(result)).toContain("u1")
  })

  it("#given user_id and extra #when built #then combines both via AND", () => {
    const extra = filterEq("agent_id", "a1")
    const result = buildSafeFilter("u1", extra)
    expect(result.AND).toHaveLength(2)
  })

  it("#given result #when validated #then always passes", () => {
    const result = buildSafeFilter("u1")
    expect(validateFilter(result).valid).toBe(true)
  })
})
