import { describe, expect, test } from "bun:test"
import { AGENT_MODEL_REQUIREMENTS } from "./agent-model-requirements"
import { resolveModelPipeline } from "./model-resolution-pipeline"

const flash = "minimax-coding-plan/MiniMax-M3.1-Flash"
const m3 = "minimax-coding-plan/MiniMax-M3"

describe("international MiniMax Coding Plan routing", () => {
  for (const agent of ["atlas", "sisyphus-junior"]) {
    const fallbackChain = AGENT_MODEL_REQUIREMENTS[agent].fallbackChain

    test(`${agent} selects Flash when available and keeps M3 for older catalogs`, () => {
      for (const [models, expected] of [[[flash, m3], flash], [[m3], m3]] as const) {
        const result = resolveModelPipeline({
          constraints: { availableModels: new Set(models) },
          policy: { fallbackChain },
        })
        expect(result?.model).toBe(expected)
        expect(result?.provenance).toBe("provider-fallback")
      }
    })

    test(`${agent} preserves explicit saved, legacy, custom and non-MiniMax selections`, () => {
      for (const model of [m3, "minimax-coding-plan/MiniMax-M2.7", "custom/my-model", "openai/gpt-5.5"]) {
        for (const intent of [{ userModel: model }, { uiSelectedModel: model }]) {
          const result = resolveModelPipeline({
            intent,
            constraints: { availableModels: new Set([flash, m3]) },
            policy: { fallbackChain },
          })
          expect(result?.model).toBe(model)
          expect(result?.provenance).toBe("override")
        }
      }
    })

    test(`${agent} does not infer China Flash eligibility`, () => {
      const result = resolveModelPipeline({
        constraints: {
          availableModels: new Set([
            "minimax-cn-coding-plan/MiniMax-M3.1-Flash",
            "minimax-cn-coding-plan/MiniMax-M3",
          ]),
        },
        policy: { fallbackChain },
      })
      expect(result?.model).toBe("minimax-cn-coding-plan/MiniMax-M3")
    })
  }
})
