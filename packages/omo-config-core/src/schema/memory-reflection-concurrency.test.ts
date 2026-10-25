import { expect, test } from "bun:test"
import { OmoMemorySettingsLayerSchema, OmoMemorySettingsSchema } from "./memory"

test("reflection concurrency defaults to one and remains configurable through a layer", () => {
  expect(OmoMemorySettingsSchema.parse({}).reflection.max_concurrent_runs).toBe(1)
  const layer = OmoMemorySettingsLayerSchema.parse({ reflection: { max_concurrent_runs: 2 } })
  expect(layer).toEqual({ reflection: { max_concurrent_runs: 2 } })
  expect(OmoMemorySettingsSchema.parse(layer).reflection.max_concurrent_runs).toBe(2)
  expect(OmoMemorySettingsSchema.safeParse({
    agents: { writer: { reflection: { max_concurrent_runs: 2 } } },
  }).success).toBe(false)
})

test.each([0, -1, 1.5, Number.POSITIVE_INFINITY, "2"])("invalid concurrency %s cannot reach a supervisor", (value) => {
  const input = { reflection: { max_concurrent_runs: value } }
  expect(OmoMemorySettingsSchema.safeParse(input).success).toBe(false)
  expect(OmoMemorySettingsLayerSchema.safeParse(input).success).toBe(false)
})
