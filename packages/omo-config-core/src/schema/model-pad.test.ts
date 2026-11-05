import { describe, expect, test } from "bun:test"

import {
  OmoConfigLayerSchema,
  OmoConfigProfileSchema,
  OmoConfigSchema,
  OmoTypedHarnessConfigSchema,
} from "../index"

const SHAPES = {
  config: OmoConfigSchema,
  harness: OmoTypedHarnessConfigSchema,
  layer: OmoConfigLayerSchema,
  profile: OmoConfigProfileSchema,
} as const

function parseInEveryShape(block: unknown) {
  return Object.entries(SHAPES).map(([shape, schema]) => [shape, schema.safeParse(block).success] as const)
}

describe("model_pad schema", () => {
  test("#given model_pad labels for every axis word #when parsed #then all four strict config shapes accept them and keep the words", () => {
    // given
    const block = { model_pad: { labels: { daily: "Claude", geeky: "GPT", normal: "Normal", heavy: "Heavy" } } }

    // when
    const results = parseInEveryShape(block)
    const parsed = OmoConfigSchema.parse(block)

    // then
    expect(results).toEqual([["config", true], ["harness", true], ["layer", true], ["profile", true]])
    expect(parsed.model_pad).toEqual({ labels: { daily: "Claude", geeky: "GPT", normal: "Normal", heavy: "Heavy" } })
  })

  test("#given labels for only some axis words #when parsed #then the unset words stay absent", () => {
    // given
    const block = { model_pad: { labels: { geeky: "GPT" } } }

    // when
    const parsed = OmoConfigSchema.parse(block)

    // then
    expect(parsed.model_pad).toEqual({ labels: { geeky: "GPT" } })
  })

  test.each([
    ["an unknown axis word", { model_pad: { labels: { obsessive: "GPT" } } }, "model_pad.labels"],
    ["an unknown model_pad key", { model_pad: { slots: {} } }, "model_pad"],
    ["a non-string label", { model_pad: { labels: { daily: 1 } } }, "model_pad.labels.daily"],
  ])("#given %s #when parsed #then every strict shape rejects it at its own path", (_name, block, path) => {
    // when
    const results = Object.values(SHAPES).map((schema) => schema.safeParse(block))

    // then
    for (const result of results) {
      expect(result.success).toBe(false)
      if (result.success) continue
      expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(path)
    }
  })
})
