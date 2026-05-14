/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"

import { parseProviderModel, resolveOverrideModel } from "./active-model"
import { setOverride, _resetAllForTests } from "./state"

describe("parseProviderModel", () => {
  test("splits a typical provider/model string", () => {
    expect(parseProviderModel("openai/gpt-5.5")).toEqual({
      providerID: "openai",
      modelID: "gpt-5.5",
    })
  })

  test("splits on the FIRST slash so provider-namespaced model ids stay together", () => {
    expect(parseProviderModel("vercel/openai/gpt-5.5")).toEqual({
      providerID: "vercel",
      modelID: "openai/gpt-5.5",
    })
  })

  test("returns undefined for a missing slash", () => {
    expect(parseProviderModel("gpt-5.5")).toBeUndefined()
  })

  test("returns undefined for a trailing slash", () => {
    expect(parseProviderModel("openai/")).toBeUndefined()
  })

  test("returns undefined for a leading slash", () => {
    expect(parseProviderModel("/gpt-5.5")).toBeUndefined()
  })
})

describe("resolveOverrideModel", () => {
  beforeEach(() => {
    _resetAllForTests()
  })

  test("returns the parsed provider/model when an override is set", () => {
    setOverride("s1", "sisyphus", { model: "openai/gpt-5.5" })

    expect(resolveOverrideModel("s1", "sisyphus")).toEqual({
      providerID: "openai",
      modelID: "gpt-5.5",
    })
  })

  test("returns undefined when no override exists for the role", () => {
    setOverride("s1", "hephaestus", { model: "openai/gpt-5.5" })

    expect(resolveOverrideModel("s1", "sisyphus")).toBeUndefined()
  })

  test("returns undefined for a missing role argument", () => {
    setOverride("s1", "sisyphus", { model: "openai/gpt-5.5" })

    expect(resolveOverrideModel("s1", undefined)).toBeUndefined()
  })

  test("overrides are session-scoped", () => {
    setOverride("s1", "sisyphus", { model: "openai/gpt-5.5" })

    expect(resolveOverrideModel("s2", "sisyphus")).toBeUndefined()
  })
})
