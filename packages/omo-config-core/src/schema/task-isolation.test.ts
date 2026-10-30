import { describe, expect, test } from "bun:test"
import { OmoTaskSettingsLayerSchema, OmoTaskSettingsSchema } from "./task"

describe("task isolation settings", () => {
  const defaults = { enabled: false, backend: "auto", apply: true, merge: "patch", commits: "generic" } as const

  test("defaults disable isolation", () => {
    expect(OmoTaskSettingsSchema.parse({}).isolation).toEqual(defaults)
    expect(OmoTaskSettingsSchema.parse({ isolation: {} }).isolation).toEqual(defaults)
  })

  test("layers preserve omission so unrelated overrides cannot reset isolation", () => {
    expect(OmoTaskSettingsLayerSchema.parse({})).toEqual({})
    expect(OmoTaskSettingsLayerSchema.parse({ isolation: { apply: false } }))
      .toEqual({ isolation: { apply: false } })
  })

  test.each([OmoTaskSettingsSchema, OmoTaskSettingsLayerSchema])("accepts overrides and rejects invalid backend", (schema) => {
    expect(schema.parse({ isolation: { enabled: true, backend: "rcopy", apply: false, merge: "branch", commits: "ai" } }).isolation)
      .toEqual({ enabled: true, backend: "rcopy", apply: false, merge: "branch", commits: "ai" })
    expect(schema.safeParse({ isolation: { backend: "projfs" } }).success).toBe(false)
  })
})
