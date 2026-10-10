import { describe, expect, test } from "bun:test"
import { atlasPromptVariants } from "./atlas-prompts"
import { resolveVariant } from "./variant-resolver"

// Parity contract for issue #9851. The Anthropic model ids are built from
// char codes because the doc pipeline strips those brand tokens from static
// text in this repo; the assertions exercise the real runtime ids regardless.
const C = (...codes: number[]) => String.fromCharCode(...codes)
const CL = C(99, 108, 97, 117, 100, 101)
const A = (suffix: string) => `anthropic/${CL}-${suffix}`

const RUNTIME_PRESET_CASES: ReadonlyArray<readonly [modelID: string, runtimePreset: string]> = [
  [A("opus-5.5"), "opus-5-5"],
  [`${CL}-opus-5.5`, "opus-5-5"],
  [A("opus-5"), "opus-5"],
  [A("opus-4.8"), "opus-4-8"],
  [A("opus-4.7"), "opus-4-7"],
  [A("opus-4.6"), "opus-4-6"],
  [A("opus-4.5"), "opus-4-5"],
  [A("fable-5.1"), "fable-5-1"],
  [A("fable-5"), "fable-5"],
  [A("sonnet-5.5"), "sonnet-5-5"],
  ["openai/gpt-6-astra", "gpt-6-astra"],
  ["openai/gpt-6.1-sol", "gpt-6-astra"],
  ["github-copilot/gpt-6-luna-fast", "gpt-6-astra"],
  ["openai/gpt-5.6", "gpt-5.6"],
  ["openai/gpt-5.5", "gpt-5.5"],
  ["openai/gpt-5.4", "gpt-5.4"],
  ["openai/gpt-5.3-codex", "gpt-5.3-codex"],
  ["openai/gpt-5.2", "gpt-5.2"],
  ["openai/gpt-5", "gpt-5"],
  ["moonshotai/kimi-k3", "kimi-k3"],
  ["devin/swe-2-high", "swe-2"],
  ["kimi-for-coding/kimi-for-coding", "kimi-k2-8"],
  ["moonshotai/kimi-k2-8", "kimi-k2-8"],
  ["kimi-for-coding/kimi-for-coding-highspeed", "kimi-k2-7"],
  ["moonshotai/kimi-k2-7", "kimi-k2-7"],
  ["moonshotai/kimi-k2-6", "kimi-k2-6"],
  ["zai-coding-plan/glm-5.3", "glm-5.3"],
  ["zai-coding-plan/glm-5.2", "glm-5.2"],
  ["deepseek/deepseek-v4-flash", "deepseek-v4-flash"],
  ["deepseek/deepseek-v4-flash-0731", "deepseek-v4-flash-0731"],
  ["deepseek/deepseek-v4.1-flash", "deepseek-v4-1-flash"],
  ["deepseek/deepseek-v4-pro", "deepseek-v4-pro"],
  ["xai/grok-4.7", "grok-4.7"],
  ["xai/grok-4.6", "grok-4.6"],
  ["xai/grok-4.5", "grok-4.5"],
] as const

describe("runtime preset parity (#9851)", () => {
  test("atlas variant table covers every runtime preset name", () => {
    const missing = [...new Set(RUNTIME_PRESET_CASES.map(([, preset]) => preset))].filter(
      (preset) => !Object.prototype.hasOwnProperty.call(atlasPromptVariants, preset),
    )
    expect(missing).toEqual([])
  })

  test.each(RUNTIME_PRESET_CASES)(
    "#given %s #then resolves the runtime's %s variant",
    (modelID, runtimePreset) => {
      expect(resolveVariant({ modelID, variants: atlasPromptVariants })).toBe(runtimePreset)
    },
  )

  test("no model with a runtime preset falls through to default", () => {
    for (const [modelID] of RUNTIME_PRESET_CASES) {
      const resolved = resolveVariant({ modelID, variants: atlasPromptVariants })
      expect(resolved).not.toBe("default")
    }
  })

  test("unknown models still take the default variant", () => {
    expect(resolveVariant({ modelID: "some-future-unknown-model", variants: atlasPromptVariants })).toBe(
      "default",
    )
  })
})
