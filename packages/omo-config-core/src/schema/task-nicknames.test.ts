import { expect, test } from "bun:test"

import { OmoTaskSettingsLayerSchema, OmoTaskSettingsSchema } from "./task"

test("multiple exact model IDs can share a pool defined in another config layer", () => {
  const base = OmoTaskSettingsLayerSchema.parse({ nicknames: { sets: { moon: [" Selene "] } } })
  const overlay = OmoTaskSettingsLayerSchema.parse({
    nicknames: { models: { "provider-a/luna": "moon", "provider-b/luna": "moon" } },
  })
  const effective = OmoTaskSettingsSchema.parse({ nicknames: { ...base.nicknames, ...overlay.nicknames } })
  expect(effective.nicknames).toEqual({
    sets: { moon: ["Selene"] },
    models: { "provider-a/luna": "moon", "provider-b/luna": "moon" },
  })
})

test("an unresolved or inherited set reference fails validation on its mapping", () => {
  const result = OmoTaskSettingsSchema.safeParse({
    nicknames: { sets: { moon: ["Selene"] }, models: { "provider/luna": "toString" }, default: "missing" },
  })
  if (result.success) throw new Error("expected invalid nickname references")
  expect(result.error.issues.map((issue) => issue.path)).toEqual([
    ["nicknames", "models", "provider/luna"],
    ["nicknames", "default"],
  ])
})

test("an empty pool or a terminal control character in a nickname fails validation", () => {
  for (const moon of [[], ["bad\u001b[31m"], ["   "]]) {
    expect(OmoTaskSettingsLayerSchema.safeParse({ nicknames: { sets: { moon } } }).success).toBe(false)
  }
})
