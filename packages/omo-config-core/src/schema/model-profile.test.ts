import { describe, expect, test } from "bun:test"

import {
  OmoModelProfileLayerSchema,
  OmoModelProfileSchema,
  OmoModelProfilesLayerSchema,
  OmoModelProfilesSchema,
} from "./model-profile"

describe("OmoModelProfileSchema", () => {
  test("#given a display_name-only profile #when parsed #then it is accepted so overriding a builtin label never fails the strict layer", () => {
    // given
    const entry = { display_name: "Capable" }

    // when
    const result = OmoModelProfileSchema.safeParse(entry)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    expect(result.data).toEqual({ display_name: "Capable" })
  })

  test("#given a chain of catalog names and tuned entries #when parsed #then both entry shapes survive", () => {
    // given
    const entry = {
      display_name: "Deep work",
      models: ["astra", { model: "openai/gpt-5.6-sol", reasoning: "medium" }],
    }

    // when
    const result = OmoModelProfileSchema.safeParse(entry)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    expect(result.data.models).toEqual(["astra", { model: "openai/gpt-5.6-sol", reasoning: "medium" }])
  })

  test("#given a legacy variant on a chain entry #when parsed #then it normalizes to reasoning like a category chain", () => {
    // given
    const entry = { models: [{ model: "openai/gpt-6-astra", variant: "high" }] }

    // when
    const result = OmoModelProfileSchema.safeParse(entry)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    expect(result.data.models).toEqual([{ model: "openai/gpt-6-astra", reasoning: "high" }])
  })

  test("#given an unknown sibling key #when parsed #then the strict profile object rejects the entry", () => {
    // given
    const entry = { display_name: "Capable", model: "anthropic/claude-fable-5-1" }

    // when
    const result = OmoModelProfileSchema.safeParse(entry)

    // then
    expect(result.success).toBe(false)
  })

  test("#given a record of profiles #when parsed #then every named profile parses independently", () => {
    // given
    const profiles = {
      capable: { display_name: "Capable", models: ["anthropic/claude-fable-5-1"] },
      "simple-work": { models: ["openai/gpt-5.6-luna-fast"] },
    }

    // when
    const result = OmoModelProfilesSchema.safeParse(profiles)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    expect(Object.keys(result.data)).toEqual(["capable", "simple-work"])
  })

  test("#given a layer profile #when parsed #then partial entries are accepted and unknown keys still rejected", () => {
    // given
    const layerEntry = { display_name: "Capable" }

    // when
    const accepted = OmoModelProfileLayerSchema.safeParse(layerEntry)
    const rejected = OmoModelProfilesLayerSchema.safeParse({ capable: { models: [], reasoning: "high" } })

    // then
    expect(accepted.success).toBe(true)
    expect(rejected.success).toBe(false)
  })
})
