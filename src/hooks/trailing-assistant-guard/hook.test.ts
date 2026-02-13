import { describe, expect, test } from "bun:test"
import { createTrailingAssistantGuardHook } from "./hook"

function makeMessage(role: "user" | "assistant", text = "hello") {
  return {
    info: { id: `msg_${Math.random()}`, role } as any,
    parts: [{ type: "text" as const, text }] as any[],
  }
}

describe("createTrailingAssistantGuardHook", () => {
  test("should remove trailing assistant message", async () => {
    //#given - messages ending with assistant
    const hook = createTrailingAssistantGuardHook()
    const messages = [
      makeMessage("user", "hi"),
      makeMessage("assistant", "hello"),
      makeMessage("user", "do stuff"),
      makeMessage("assistant", "orphaned response"),
    ]
    const output = { messages }

    //#when - transform runs
    await hook["experimental.chat.messages.transform"]!({} as any, output)

    //#then - trailing assistant removed, last message is user
    expect(output.messages).toHaveLength(3)
    expect(output.messages[output.messages.length - 1].info.role).toBe("user")
  })

  test("should remove multiple trailing assistant messages", async () => {
    //#given - messages ending with two assistant messages
    const hook = createTrailingAssistantGuardHook()
    const messages = [
      makeMessage("user", "hi"),
      makeMessage("assistant", "first"),
      makeMessage("assistant", "second"),
    ]
    const output = { messages }

    //#when - transform runs
    await hook["experimental.chat.messages.transform"]!({} as any, output)

    //#then - both trailing assistants removed
    expect(output.messages).toHaveLength(1)
    expect(output.messages[0].info.role).toBe("user")
  })

  test("should not remove anything when last message is user", async () => {
    //#given - messages ending with user (normal case)
    const hook = createTrailingAssistantGuardHook()
    const messages = [
      makeMessage("user", "hi"),
      makeMessage("assistant", "hello"),
      makeMessage("user", "continue"),
    ]
    const output = { messages }

    //#when - transform runs
    await hook["experimental.chat.messages.transform"]!({} as any, output)

    //#then - no changes
    expect(output.messages).toHaveLength(3)
  })

  test("should not remove the only message even if assistant", async () => {
    //#given - single assistant message (edge case)
    const hook = createTrailingAssistantGuardHook()
    const messages = [makeMessage("assistant", "solo")]
    const output = { messages }

    //#when - transform runs
    await hook["experimental.chat.messages.transform"]!({} as any, output)

    //#then - message preserved (never empty the array)
    expect(output.messages).toHaveLength(1)
  })

  test("should handle empty messages array", async () => {
    //#given - empty messages
    const hook = createTrailingAssistantGuardHook()
    const output = { messages: [] as any[] }

    //#when - transform runs
    await hook["experimental.chat.messages.transform"]!({} as any, output)

    //#then - no error, still empty
    expect(output.messages).toHaveLength(0)
  })

  test("should preserve middle assistant messages", async () => {
    //#given - assistant in middle, user at end
    const hook = createTrailingAssistantGuardHook()
    const messages = [
      makeMessage("user", "q1"),
      makeMessage("assistant", "a1"),
      makeMessage("user", "q2"),
      makeMessage("assistant", "a2"),
      makeMessage("user", "q3"),
    ]
    const output = { messages }

    //#when - transform runs
    await hook["experimental.chat.messages.transform"]!({} as any, output)

    //#then - all messages preserved
    expect(output.messages).toHaveLength(5)
  })
})
