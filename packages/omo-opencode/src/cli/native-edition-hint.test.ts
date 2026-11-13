import { describe, expect, it } from "bun:test"
import {
  NATIVE_EDITION_GUIDE_URL,
  NATIVE_EDITION_HINT_TITLE,
  NATIVE_EDITION_INSTALL_COMMAND,
  nativeEditionHintLines,
  shouldShowNativeEditionHint,
} from "./native-edition-hint"

describe("nativeEditionHintLines", () => {
  it("names the install command and the guide link", () => {
    // given / when
    const text = nativeEditionHintLines().join("\n")

    // then
    expect(text).toContain(NATIVE_EDITION_INSTALL_COMMAND)
    expect(text).toContain(NATIVE_EDITION_GUIDE_URL)
  })

  it("routes the command and the link through the caller's paint", () => {
    // given
    const paint = {
      command: (value: string) => `<cmd>${value}</cmd>`,
      link: (value: string) => `<link>${value}</link>`,
    }

    // when
    const text = nativeEditionHintLines(paint).join("\n")

    // then
    expect(text).toContain(`<cmd>${NATIVE_EDITION_INSTALL_COMMAND}</cmd>`)
    expect(text).toContain(`<link>${NATIVE_EDITION_GUIDE_URL}</link>`)
  })

  it("sells the benefit under the OmO Native brand and never names the engine", () => {
    // given / when
    const text = [NATIVE_EDITION_HINT_TITLE, ...nativeEditionHintLines()].join("\n")

    // then
    expect(text).toContain("OmO Native")
    expect(text).toContain("no OpenCode host required")
    expect(text).toContain("This install keeps working as-is.")
    expect(text).not.toMatch(/senpi/i)
  })
})

describe("shouldShowNativeEditionHint", () => {
  it("shows the hint for an OpenCode-edition install", () => {
    expect(shouldShowNativeEditionHint({ hasNative: false, hasNativeDev: false })).toBe(true)
  })

  it("hides the hint when the install target is OmO Native itself", () => {
    expect(shouldShowNativeEditionHint({ hasNative: true, hasNativeDev: false })).toBe(false)
  })

  it("hides the hint when the install target is the native development adapter", () => {
    expect(shouldShowNativeEditionHint({ hasNative: false, hasNativeDev: true })).toBe(false)
  })
})
