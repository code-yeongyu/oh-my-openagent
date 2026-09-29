import { describe, expect, it } from "bun:test"
import { gate } from "./language"
import { reply } from "./testing"

describe("language gate", () => {
  it("#given allow en #when the text is English with a labeled link and a Korean mention display #then it passes", async () => {
    expect(await gate.run(reply("Done: see <https://x.test|the fix> for <@U000ALICE|\uC5F0\uADDC>."), { allow: ["en"] }, {})).toEqual({ ok: true })
  })

  it("#given allow en #when the text contains Hangul #then it is refused naming Korean", async () => {
    const result = await gate.run(reply("Status: \uC644\uB8CC\uD588\uC2B5\uB2C8\uB2E4"), { allow: ["en"] }, {})
    expect(result).toEqual({ refuse: expect.stringContaining("Korean") })
  })

  it("#given allow en #when Latin text hides Cyrillic homoglyphs #then it is refused", async () => {
    const result = await gate.run(reply("\u041D\u0435llo team"), { allow: ["en"] }, {})
    expect(result).toEqual({ refuse: expect.stringContaining("Cyrillic") })
  })

  it("#given allow en #when a link label is Korean #then it is refused", async () => {
    expect(await gate.run(reply("<https://x.test|\uBB38\uC11C>"), { allow: ["en"] }, {})).toHaveProperty("refuse")
  })

  it("#given allow en-US and ko #when mixed English and Korean #then it passes", async () => {
    expect(await gate.run(reply("PR merged, \uD655\uC778 \uBD80\uD0C1\uB4DC\uB824\uC694"), { allow: ["en-US", "ko"] }, {})).toEqual({ ok: true })
  })

  it("#given an unknown language tag #when run #then it throws a params error (the pipeline refuses)", () => {
    expect(() => gate.run(reply("hello"), { allow: ["xx"] }, {})).toThrow("unknown language tag 'xx'")
  })
})
