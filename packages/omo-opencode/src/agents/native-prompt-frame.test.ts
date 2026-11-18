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
      return { frame: "REBUILT_SENTINEL", role: "" }
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
      return { frame: "REBUILT", role: "" }
    })
    expect(system).toEqual([input])
    expect(calls).toBe(0)
  })

  test.each([
    [
      "swaps the role the old build put after the frame",
      false,
      "\n\nOLD_ROLE\nUSER_APPEND",
      "\n\nNEW_ROLE\nUSER_APPEND",
    ],
    ["adds the role when the old build put none after the frame", true, "\nUSER_APPEND", "\n\nNEW_ROLE\nUSER_APPEND"],
    [
      "swaps only the frame when other text sits where the role was",
      false,
      "\n\nEDITED\nUSER_APPEND",
      "\n\nEDITED\nUSER_APPEND",
    ],
  ])("a rebuild of a role-bearing frame %s", (_case, standalone, after, expectedAfter) => {
    const before = frameNativePrompt("CORE_SENTINEL", {
      model: "old/model",
      tools: [],
      role: "OLD_ROLE",
      ...(standalone ? { standalone: true as const } : {}),
    })
    const system = ["BEFORE\n" + before + after]
    replaceNativePromptFrames(system, "new/model", (context) => {
      expect(context.model).toBe("new/model")
      expect(context.role).toBe("OLD_ROLE")
      return { frame: "REBUILT_SENTINEL", role: "NEW_ROLE" }
    })
    expect(system).toEqual(["BEFORE\nREBUILT_SENTINEL" + expectedAfter])
  })

  test("does not rebuild a frame already bound to the runtime model", () => {
    const input = frameNativePrompt("CORE", { model: "same/model", tools: [] })
    const system = [input]
    let calls = 0
    replaceNativePromptFrames(system, "same/model", () => {
      calls++
      return { frame: "REBUILT", role: "" }
    })
    expect(system).toEqual([input])
    expect(calls).toBe(0)
  })
})
