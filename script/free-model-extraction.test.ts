/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { extractFreeOpenCodeModelIds } from "./free-model-extraction"

describe("extractFreeOpenCodeModelIds", () => {
  test("extracts free model IDs sorted alphabetically", () => {
    const raw = {
      opencode: {
        models: {
          "z-model": { status: "active", cost: { input: 0, output: 0 } },
          "a-model": { status: "active", cost: { input: 0, output: 0 } },
        },
      },
    }
    expect(extractFreeOpenCodeModelIds(raw)).toEqual(["a-model", "z-model"])
  })

  test("excludes deprecated models", () => {
    const raw = {
      opencode: {
        models: {
          "live-model": { cost: { input: 0, output: 0 } },
          "dead-model": { status: "deprecated", cost: { input: 0, output: 0 } },
        },
      },
    }
    expect(extractFreeOpenCodeModelIds(raw)).toEqual(["live-model"])
  })

  test("excludes models with paid input cost", () => {
    const raw = {
      opencode: {
        models: {
          "free-model": { cost: { input: 0, output: 0 } },
          "paid-input": { cost: { input: 5, output: 0 } },
        },
      },
    }
    expect(extractFreeOpenCodeModelIds(raw)).toEqual(["free-model"])
  })

  test("excludes models with paid output cost", () => {
    const raw = {
      opencode: {
        models: {
          "free-model": { cost: { input: 0, output: 0 } },
          "paid-output": { cost: { input: 0, output: 3 } },
        },
      },
    }
    expect(extractFreeOpenCodeModelIds(raw)).toEqual(["free-model"])
  })

  test("returns empty array for null input", () => {
    expect(extractFreeOpenCodeModelIds(null)).toEqual([])
  })

  test("returns empty array when opencode provider is missing", () => {
    expect(extractFreeOpenCodeModelIds({ other: {} })).toEqual([])
  })

  test("returns empty array when models key is missing", () => {
    expect(extractFreeOpenCodeModelIds({ opencode: {} })).toEqual([])
  })

  test("returns empty array when all models are deprecated", () => {
    const raw = {
      opencode: {
        models: {
          m1: { status: "deprecated", cost: { input: 0, output: 0 } },
        },
      },
    }
    expect(extractFreeOpenCodeModelIds(raw)).toEqual([])
  })

  test("skips entries without cost field", () => {
    const raw = {
      opencode: {
        models: {
          "no-cost": { status: "active" },
          "has-cost": { cost: { input: 0, output: 0 } },
        },
      },
    }
    expect(extractFreeOpenCodeModelIds(raw)).toEqual(["has-cost"])
  })
})
