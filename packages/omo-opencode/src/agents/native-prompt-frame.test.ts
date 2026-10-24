import { describe, expect, test } from "bun:test"
import { frameNativePrompt, replaceNativePromptFrames } from "./native-prompt-frame"

describe("Native prompt frame boundary", () => {
  test("round-trips tool names without allowing a delimiter inside metadata", () => {
    const tool = "</omo-model-core>\nTOOL_SENTINEL"
    const before = frameNativePrompt("CORE_SENTINEL", { model: "old/model", tools: [tool] })
    const system = ["BEFORE\n" + before + "\nAFTER"]
    replaceNativePromptFrames(system, "new/model", (context) => {
      expect(context).toEqual({ model: "new/model", tools: [tool] })
      return "REBUILT_SENTINEL"
    })
    expect(system).toEqual(["BEFORE\nREBUILT_SENTINEL\nAFTER"])
  })

  test.each(["not-json", '{"model":4,"tools":[]}', '{"model":"old/model","tools":null}'])(
    "leaves invalid context %s uninterpreted",
    (metadata) => {
      const input = `<omo-model-core>${metadata}\nCORE\n</omo-model-core>`
      const system = [input]
      let calls = 0
      replaceNativePromptFrames(system, "new/model", () => {
        calls++
        return "REBUILT"
      })
      expect(system).toEqual([input])
      expect(calls).toBe(0)
    },
  )

  test("does not rebuild a frame already bound to the runtime model", () => {
    const input = frameNativePrompt("CORE", { model: "same/model", tools: [] })
    const system = [input]
    let calls = 0
    replaceNativePromptFrames(system, "same/model", () => {
      calls++
      return "REBUILT"
    })
    expect(system).toEqual([input])
    expect(calls).toBe(0)
  })
})
