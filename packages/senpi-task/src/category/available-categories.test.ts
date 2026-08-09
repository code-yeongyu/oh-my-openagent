/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { resolveAvailableCategoryNames } from "./resolver"
import type { SenpiModelRegistryPort } from "./types"

type FakeModel = { readonly provider: string; readonly id: string }

function fakeRegistry(models: readonly FakeModel[]): SenpiModelRegistryPort<FakeModel> {
  return {
    getAvailable: () => models,
    find: (provider: string, modelId: string) =>
      models.find((model) => model.provider === provider && model.id === modelId),
  }
}

describe("resolveAvailableCategoryNames", () => {
  describe("#given no user categories and a registry exposing the architect gate model", () => {
    describe("#when the runtime category list is resolved", () => {
      it("#then the builtin architect category is exposed", () => {
        const names = resolveAvailableCategoryNames({}, fakeRegistry([{ provider: "anthropic", id: "claude-fable-5" }]))
        expect(names).toContain("architect")
      })
    })
  })

  describe("#given no user categories and a registry without the architect gate model", () => {
    describe("#when the runtime category list is resolved", () => {
      it("#then the builtin architect category is not exposed", () => {
        const names = resolveAvailableCategoryNames({}, fakeRegistry([{ provider: "omo-mock", id: "mock-weak" }]))
        expect(names).not.toContain("architect")
        expect(names).toEqual([])
      })
    })
  })

  describe("#given a user-declared architect category", () => {
    describe("#when the registry lacks the gate model", () => {
      it("#then the explicit declaration still exposes architect", () => {
        const names = resolveAvailableCategoryNames(
          { categories: { architect: { model: "anthropic/claude-fable-5" } } },
          fakeRegistry([{ provider: "omo-mock", id: "mock-weak" }]),
        )
        expect(names).toContain("architect")
      })
    })
  })

  describe("#given a registry whose getAvailable throws", () => {
    describe("#when the runtime category list is resolved", () => {
      it("#then it degrades to the ungated list instead of throwing", () => {
        const names = resolveAvailableCategoryNames({}, {
          getAvailable: () => {
            throw new Error("registry not ready")
          },
          find: () => undefined,
        })
        expect(names).toContain("architect")
      })
    })
  })
})
