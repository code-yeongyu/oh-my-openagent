import { describe, test, expect } from "bun:test"
import { resolvePresetName } from "@code-yeongyu/senpi/prompt-presets"
import { getAtlasPromptSource } from "./agent"

// Uncatalogued aliases exercise the same provider/model parsing as the factory.
describe("Atlas delegates uncatalogued selection to Native", () => {
  test.each(["synthetic/vendor/gpt-5.4", "synthetic/vendor/claude-opus-5-5", "synthetic/deepseek-v4-flash", "synthetic/gemini-3.1-pro", "synthetic/k2p7", "synthetic/unknown"])("%s", (model) => {
    const slash = model.indexOf("/")
    const expected = resolvePresetName({ providerID: model.slice(0, slash), modelID: model.slice(slash + 1) }) ?? "default"
    expect(getAtlasPromptSource(model)).toBe(expected)
  })
  test("undefined model uses the Native default", () => {
    expect(getAtlasPromptSource()).toBe("default")
  })
})
