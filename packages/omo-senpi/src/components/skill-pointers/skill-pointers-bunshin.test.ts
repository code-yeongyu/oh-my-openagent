import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { BUNSHIN_CUSTOM_TYPE, matchedSkillPointerNames } from "./index"
import { dispatchInput, expectNoInjection, injectedContent, registerSkillPointers } from "./test-support"

describe("omo-senpi skill-pointers bunshin pointer", () => {
  it("#given fleet wording #when matched #then the bunshin pointer target fires", () => {
    const triggers = [
      "run this on builder via bunshin",
      "list my fleet",
      "Fleet status please",
      "check the machine mesh",
      "machine-mesh health",
    ] as const
    for (const text of triggers) {
      expect({ text, matched: matchedSkillPointerNames(text) }).toEqual({ text, matched: ["bunshin"] })
    }
  })

  it("#given near-miss wording #when matched #then nothing fires", () => {
    const misses = [
      "fleeting thought",
      "bunshins",
      "the mesh network",
      "machine learning",
      "`bunshin` in a code span",
      "mybunshin_helper",
    ] as const
    for (const text of misses) {
      expect({ text, matched: matchedSkillPointerNames(text) }).toEqual({ text, matched: [] })
    }
  })

  it("#given an interactive prompt naming the fleet #when dispatched #then one hidden bunshin pointer carries the SDK root env key", async () => {
    const pi = new FakeExtensionAPI()
    await registerSkillPointers(pi)
    const result = await dispatchInput(pi, "list my fleet")
    expect(result).toEqual({ action: "continue" })
    expect(pi.messages.map((call) => [call.message["customType"], call.message["display"]])).toEqual([
      [BUNSHIN_CUSTOM_TYPE, false],
    ])
    const content = injectedContent(pi, BUNSHIN_CUSTOM_TYPE)
    expect(content).toStartWith("<omo-bunshin-pointer>")
    expect(content).toContain("OMO_BUNSHIN_TS_SDK_ROOT")
  })

  it("#given a prompt without fleet wording #when dispatched #then no bunshin pointer is injected", async () => {
    const pi = new FakeExtensionAPI()
    await registerSkillPointers(pi)
    expectNoInjection(pi, await dispatchInput(pi, "rename this variable"))
  })
})
