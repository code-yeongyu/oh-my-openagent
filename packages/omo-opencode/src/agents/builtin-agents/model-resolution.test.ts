/// <reference types="bun-types" />

import { afterEach, describe, expect, spyOn, test } from "bun:test"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { getFirstFallbackModel } from "./model-resolution"

const SISYPHUS_PRIMARY = {
  fallbackChain: [
    {
      providers: ["anthropic", "github-copilot", "opencode"],
      model: "claude-opus-5",
      variant: "max",
    },
  ],
}

afterEach(() => {
  connectedProvidersCache._resetMemCacheForTesting()
})

describe("getFirstFallbackModel", () => {
  describe("#given a fallback entry with multiple providers", () => {
    test("#when availableModels only lists a later provider #then that provider is chosen", () => {
      // given
      const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
      const availableModels = new Set(["github-copilot/claude-opus-5"])

      try {
        // when
        const result = getFirstFallbackModel(SISYPHUS_PRIMARY, availableModels)

        // then
        expect(result).toEqual({
          model: "github-copilot/claude-opus-5",
          provenance: "provider-fallback",
          variant: "max",
        })
      } finally {
        cacheSpy.mockRestore()
      }
    })

    test("#when availableModels is empty and a later provider is connected #then that provider is chosen", () => {
      // given
      const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([
        "github-copilot",
        "opencode",
      ])

      try {
        // when
        const result = getFirstFallbackModel(SISYPHUS_PRIMARY, new Set())

        // then
        expect(result).toEqual({
          model: "github-copilot/claude-opus-5",
          provenance: "provider-fallback",
          variant: "max",
        })
      } finally {
        cacheSpy.mockRestore()
      }
    })

    test("#when no provider is connected or catalogued #then providers[0] is used", () => {
      // given
      const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)

      try {
        // when
        const result = getFirstFallbackModel(SISYPHUS_PRIMARY, new Set())

        // then
        expect(result).toEqual({
          model: "anthropic/claude-opus-5",
          provenance: "provider-fallback",
          variant: "max",
        })
      } finally {
        cacheSpy.mockRestore()
      }
    })
  })

  describe("#given an empty requirement", () => {
    test("#when fallbackChain is missing #then undefined is returned", () => {
      expect(getFirstFallbackModel(undefined, new Set())).toBeUndefined()
      expect(getFirstFallbackModel({ fallbackChain: [] }, new Set())).toBeUndefined()
    })
  })
})
