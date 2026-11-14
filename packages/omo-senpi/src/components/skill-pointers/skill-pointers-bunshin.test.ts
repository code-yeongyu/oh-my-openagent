import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { BUNSHIN_CUSTOM_TYPE, matchedSkillPointerNames } from "./index"
import { dispatchInput, expectNoInjection, injectedContent, registerSkillPointers } from "./test-support"

describe("omo-senpi skill-pointers bunshin pointer", () => {
  it("#given fleet wording #when matched #then the bunshin pointer target fires", () => {
    const triggers = [
      "run this on builder via bunshin",
      "list my fleet",
      "run uptime on our fleet",
      "restart the fleet hosts",
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
      // A fleet with no device sense (#13446): the plain word names vehicles, ships or a UI, not this user's machines.
      "Fleet status please",
      "the delivery fleet schedule",
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

  it("#given the plain word fleet in an unrelated request #when dispatched #then no hidden pointer is injected (#13446)", async () => {
    const pi = new FakeExtensionAPI()
    await registerSkillPointers(pi)
    expectNoInjection(pi, await dispatchInput(pi, "the fleet dashboard CSS is broken"))
  })

  it("#given a device-operations request #when dispatched #then the hidden bunshin pointer is still injected", async () => {
    const pi = new FakeExtensionAPI()
    await registerSkillPointers(pi)
    const result = await dispatchInput(pi, "check disk usage on every machine in my fleet")
    expect(result).toEqual({ action: "continue" })
    expect(pi.messages.map((call) => [call.message["customType"], call.message["display"]])).toEqual([
      [BUNSHIN_CUSTOM_TYPE, false],
    ])
  })

  it("#given a prompt without fleet wording #when dispatched #then no bunshin pointer is injected", async () => {
    const pi = new FakeExtensionAPI()
    await registerSkillPointers(pi)
    expectNoInjection(pi, await dispatchInput(pi, "rename this variable"))
  })
})
