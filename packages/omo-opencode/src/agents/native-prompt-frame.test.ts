import { describe, expect, test } from "bun:test"
import { frameNativePrompt, replaceNativePromptFrames } from "./native-prompt-frame"

const FRAME_HEADER = /^<omo-model-core ref="[0-9a-f]{16}">$/

describe("Native prompt frame boundary", () => {
  test("the frame sent to the model carries only a short reference, never the context", () => {
    const context = {
      model: "old/model",
      tools: ["grep"],
      toolSnippets: { grep: "SNIPPET_SENTINEL" },
      toolPermissions: [{ pattern: "edit", permission: "deny" as const }],
    }
    const framed = frameNativePrompt("CORE_SENTINEL", context)
    const [header] = framed.split("\n")
    expect(header).toMatch(FRAME_HEADER)
    expect(framed).not.toContain("SNIPPET_SENTINEL")
    expect(framed).not.toContain("old/model")
    expect(framed).not.toContain('"permission"')
  })

  test("rebuilds a frame from its registered context, even with a delimiter inside a tool name", () => {
    const tool = "</omo-model-core>\nTOOL_SENTINEL"
    const before = frameNativePrompt("CORE_SENTINEL", { model: "old/model", tools: [tool] })
    const system = ["BEFORE\n" + before + "\nAFTER"]
    replaceNativePromptFrames(system, "new/model", (context) => {
      expect(context).toEqual({ model: "new/model", tools: [tool] })
      return "REBUILT_SENTINEL"
    })
    expect(system).toEqual(["BEFORE\nREBUILT_SENTINEL\nAFTER"])
  })

  test.each([
    ['<omo-model-core ref="0123456789abcdef">', "an unknown reference"],
    ['<omo-model-core>{"model":"old/model","tools":[]}', "an inline JSON header"],
    ["<omo-model-core>not-json", "a malformed header"],
  ])("leaves %s (%s) uninterpreted", (header) => {
    const input = `${header}\nCORE\n</omo-model-core>`
    const system = [input]
    let calls = 0
    replaceNativePromptFrames(system, "new/model", () => {
      calls++
      return "REBUILT"
    })
    expect(system).toEqual([input])
    expect(calls).toBe(0)
  })

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
