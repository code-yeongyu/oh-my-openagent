import { describe, expect, test } from "bun:test"
import { applyAutomaticLocalePromptPreference, buildAutomaticLocalePromptAppend, getAutoLocaleLanguageLabel } from "./auto-locale-prompt-append"

describe("auto locale prompt append", () => {
  test("returns no language label for english locales", () => {
    expect(getAutoLocaleLanguageLabel("en-US")).toBeUndefined()
    expect(getAutoLocaleLanguageLabel("en_GB.UTF-8")).toBeUndefined()
  })

  test("maps supported locales to a concise target language label", () => {
    expect(getAutoLocaleLanguageLabel("zh-CN")).toBe("Simplified Chinese")
    expect(getAutoLocaleLanguageLabel("ja-JP")).toBe("Japanese")
    expect(getAutoLocaleLanguageLabel("pt-BR")).toBe("Brazilian Portuguese")
  })

  test("appends a short locale prompt only for non-english locales", () => {
    const base = { prompt: "Base prompt" }
    const zh = applyAutomaticLocalePromptPreference(base, "zh-CN")
    const en = applyAutomaticLocalePromptPreference(base, "en-US")

    expect(zh.prompt).toContain("default to concise Simplified Chinese")
    expect(zh.prompt).toContain("Optimize for brevity")
    expect(en.prompt).toBe("Base prompt")
  })

  test("builds a compact appendix", () => {
    const appendix = buildAutomaticLocalePromptAppend("zh-CN")
    expect(appendix).toBeDefined()
    expect(appendix!.length).toBeLessThan(320)
  })
})
