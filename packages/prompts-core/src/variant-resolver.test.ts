import { describe, expect, test } from "bun:test"

import { resolveVariant } from "./variant-resolver"
import { NoMatchingVariantError, type VariantTable } from "./types"

const isGpt = (input: { modelID?: string; agentName?: string }): boolean =>
  input.modelID?.includes("gpt") ?? false

const isGemini = (input: { modelID?: string; agentName?: string }): boolean =>
  input.modelID?.includes("gemini") ?? false

const isPlanner = (input: { modelID?: string; agentName?: string }): boolean =>
  input.agentName === "prometheus"

const alwaysFalse = (): boolean => false

describe("resolveVariant", () => {
  describe("#given declared model variants", () => {
    test("#when claude opus has no model match #then returns default fallback", () => {
      // given
      const variants = {
        gpt: { test: isGpt },
        gemini: { test: isGemini },
        default: { fallback: true },
      } satisfies VariantTable

      // when
      const actual = resolveVariant({ modelID: "claude-opus-4-7", variants })

      // then
      console.info("S1 actual:", actual)
      expect(actual).toBe("default")
    })

    test("#when openai gpt model matches #then returns gpt", () => {
      // given
      const variants = {
        gpt: { test: isGpt },
        gemini: { test: isGemini },
        default: { fallback: true },
      } satisfies VariantTable

      // when
      const actual = resolveVariant({ modelID: "openai/gpt-5.5", variants })

      // then
      console.info("S2 actual:", actual)
      expect(actual).toBe("gpt")
    })

    test("#when google gemini model matches #then returns gemini", () => {
      // given
      const variants = {
        gpt: { test: isGpt },
        gemini: { test: isGemini },
        default: { fallback: true },
      } satisfies VariantTable

      // when
      const actual = resolveVariant({ modelID: "google/gemini-3-1-pro", variants })

      // then
      console.info("S3 actual:", actual)
      expect(actual).toBe("gemini")
    })
  })

  describe("#given agent and fallback variants", () => {
    test("#when agent and model both match #then declared agent variant wins", () => {
      // given
      const variants = {
        planner: { test: isPlanner },
        gpt: { test: isGpt },
      } satisfies VariantTable

      // when
      const actual = resolveVariant({
        agentName: "prometheus",
        modelID: "openai/gpt-5.5",
        variants,
      })

      // then
      console.info("S4 actual:", actual)
      expect(actual).toBe("planner")
    })

    test("#when no context is provided #then returns default fallback", () => {
      // given
      const variants = {
        default: { fallback: true },
      } satisfies VariantTable

      // when
      const actual = resolveVariant({ variants })

      // then
      console.info("S5 actual:", actual)
      expect(actual).toBe("default")
    })

    test("#when no variant test matches #then returns fallback", () => {
      // given
      const variants = {
        gpt: { test: alwaysFalse },
        default: { fallback: true },
      } satisfies VariantTable

      // when
      const actual = resolveVariant({ modelID: "unknown-model", variants })

      // then
      console.info("S6 actual:", actual)
      expect(actual).toBe("default")
    })

    test("#when no variant matches and no fallback exists #then throws", () => {
      // given
      const variants = {
        a: { test: alwaysFalse },
      } satisfies VariantTable

      // when
      let actual = "no throw"
      let thrown: unknown
      try {
        actual = resolveVariant({ modelID: "x", variants })
      } catch (error) {
        thrown = error
        if (error instanceof Error) {
          actual = error.name
        } else {
          throw error
        }
      }
      console.info("S7 actual:", actual)

      // then
      expect(thrown).toBeInstanceOf(NoMatchingVariantError)
    })
  })
})
