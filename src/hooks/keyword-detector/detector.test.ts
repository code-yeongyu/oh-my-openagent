import { describe, expect, it } from "bun:test"
import { detectKeywordsWithType } from "./detector"

describe("keyword-detector ultrawork alias", () => {
  it("treats `ulw` as `ultrawork` and forbids questioning it", () => {
    const detected = detectKeywordsWithType("ulw")
    const ultrawork = detected.find((k) => k.type === "ultrawork")

    expect(ultrawork).toBeDefined()
    if (!ultrawork) {
      throw new Error("Expected ultrawork keyword to be detected")
    }

    expect(ultrawork.message).toContain("`ulw`")
    expect(ultrawork.message.toLowerCase()).toContain("alias")
    expect(ultrawork.message.toLowerCase()).toContain("do not")
    expect(ultrawork.message.toLowerCase()).toContain("ask")
  })

  it("uses a lighter ultrawork prompt for openai models", () => {
    // #given
    const context = { model: { providerID: "openai", modelID: "gpt-5.2" } }

    // #when
    const detected = detectKeywordsWithType("ulw", context)
    const ultrawork = detected.find((k) => k.type === "ultrawork")

    // #then
    expect(ultrawork).toBeDefined()
    expect(ultrawork?.message).toContain("Ultrawork Lite")
  })
})
