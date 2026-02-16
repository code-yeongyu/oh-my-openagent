import { describe, expect, it } from "bun:test"
import { createAmbiguityDetectorHook } from "./index"

describe("ambiguity-detector", () => {
  const createOutput = (text: string) => ({
    message: {} as Record<string, unknown>,
    parts: [{ type: "text", text }],
  })

  it("#given a vague user message without specific targets #when processed #then injects clarification guidance", async () => {
    //#given a vague user message without specific targets
    const hook = createAmbiguityDetectorHook({} as any)
    const output = createOutput("fix this quickly")

    //#when the ambiguity detector processes it
    await hook["chat.message"]({ sessionID: "s1" }, output)

    //#then it should inject clarification guidance
    expect(output.parts).toHaveLength(2)
    expect(output.parts[1].type).toBe("text")
    expect(output.parts[1].text).toContain("Clarification needed")
  })

  it("#given a specific user message with file path #when processed #then does not inject guidance", async () => {
    //#given a specific user message with file paths
    const hook = createAmbiguityDetectorHook({} as any)
    const output = createOutput("Update src/plugin/chat-message.ts:79 to call new hook")

    //#when the ambiguity detector processes it
    await hook["chat.message"]({ sessionID: "s1" }, output)

    //#then it should NOT inject any guidance
    expect(output.parts).toHaveLength(1)
    expect(output.parts[0].text).toBe("Update src/plugin/chat-message.ts:79 to call new hook")
  })

  it("#given message with no text parts #when processed #then does nothing", async () => {
    const hook = createAmbiguityDetectorHook({} as any)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "tool_use" as const }],
    }

    await hook["chat.message"]({ sessionID: "s1" }, output)

    expect(output.parts).toHaveLength(1)
    expect(output.parts[0].type).toBe("tool_use")
  })
})
