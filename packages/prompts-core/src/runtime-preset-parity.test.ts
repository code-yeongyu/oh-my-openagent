import { describe, expect, test } from "bun:test"
import { RUNTIME_PRESET_MODEL_CASES, atlasPromptVariants } from "./atlas-preset-contract"
import type { VariantTable } from "./types"
import { resolveVariant } from "./variant-resolver"

// Runtime-driven preset parity (issue #9851): every shared RUNTIME_PRESET_MODEL_CASES row resolves
// to its Atlas variant through resolveVariant over atlasPromptVariants. The senpi runtime shares
// this case shape via PROMPT_PRESET_MODEL_CASES (senpi PR #3075); once the published
// @code-yeongyu/senpi carries that contract, this test converges to import and resolve the
// runtime's fixture so both surfaces resolve the same ids to the same presets.

const CASES_BY_PRESET = new Map(RUNTIME_PRESET_MODEL_CASES.map((testCase) => [testCase.preset, testCase]))

describe("runtime preset parity (#9851)", () => {
  test("every fixture case resolves to its Atlas variant", () => {
    for (const testCase of RUNTIME_PRESET_MODEL_CASES) {
      const variant = resolveVariant({
        providerID: testCase.providerID,
        modelID: testCase.modelID,
        variants: atlasPromptVariants,
      })
      expect(variant, `${testCase.providerID}/${testCase.modelID}`).toBe(testCase.preset)
    }
  })

  test("every fixture preset exists in the atlas variant table", () => {
    for (const testCase of RUNTIME_PRESET_MODEL_CASES) {
      expect(testCase.preset in atlasPromptVariants, testCase.preset).toBe(true)
    }
  })

  test("no fixture case falls through to default", () => {
    for (const testCase of RUNTIME_PRESET_MODEL_CASES) {
      const variant = resolveVariant({
        providerID: testCase.providerID,
        modelID: testCase.modelID,
        variants: atlasPromptVariants,
      })
      expect(variant, `${testCase.providerID}/${testCase.modelID}`).not.toBe("default")
    }
  })

  test("dotted releases resolve before their generic family substring", () => {
    const fable51 = CASES_BY_PRESET.get("fable-5-1")
    const opus55 = CASES_BY_PRESET.get("opus-5-5")
    expect(fable51).toBeDefined()
    expect(opus55).toBeDefined()
    expect(resolveVariant({ providerID: "anthropic", modelID: fable51?.modelID, variants: atlasPromptVariants })).toBe(
      "fable-5-1",
    )
    expect(resolveVariant({ providerID: "anthropic", modelID: opus55?.modelID, variants: atlasPromptVariants })).toBe(
      "opus-5-5",
    )
  })

  test("unknown models still take the default variant", () => {
    const table: VariantTable = { default: atlasPromptVariants.default }
    expect(resolveVariant({ modelID: "acme-unknown-9000", variants: table })).toBe("default")
  })
})
