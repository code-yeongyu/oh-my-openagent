import { describe, expect, test } from "bun:test"
import { readItem } from "./read-item"

describe("readItem", () => {
  test("#given an assistant message a provider error ended (#14278) #when it is read #then its error text is in the item, not an empty []", () => {
    const item = readItem(
      {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: '429: {"message":"rate limited"} (retry-after-ms: 45000)',
      },
      0,
    )

    expect(item).toEqual({
      seq: 1,
      role: "assistant",
      content: JSON.stringify([{ type: "error", text: '429: {"message":"rate limited"} (retry-after-ms: 45000)' }]),
    })
  })

  test("#given a provider-error message with no content field and a long error #when it is read #then the item carries only the capped error, never the whole message with the uncapped text", () => {
    const error = `429 ${"x".repeat(2000)}`
    const item = readItem({ role: "assistant", stopReason: "error", errorMessage: error }, 0)

    expect(item.content).toBe(JSON.stringify([{ type: "error", text: error.slice(0, 500) }]))
  })

  test("#given an ordinary message #when it is read #then its content is rendered as before", () => {
    const content = [{ type: "text", text: "hello" }]

    expect(readItem({ role: "user", content }, 2)).toEqual({ seq: 3, role: "user", content: JSON.stringify(content) })
  })
})
