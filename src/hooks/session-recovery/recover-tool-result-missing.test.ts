/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test"
import { findBrokenMessageByIndex } from "./recover-tool-result-missing"
import type { MessageData } from "./types"

function makeAssistantMsg(id: string, parts?: MessageData["parts"], error?: unknown): MessageData {
  return {
    info: { id, role: "assistant", error },
    parts,
  }
}

function makeUserMsg(id: string): MessageData {
  return {
    info: { id, role: "user" },
    parts: [],
  }
}

describe("findBrokenMessageByIndex", () => {
  it("#given error referencing messages.39 and an assistant msg with tool parts #when finding #then returns the assistant msg with tool parts", () => {
    //#given
    const brokenMsg = makeAssistantMsg("msg-broken", [
      { type: "tool", callID: "toolu_abc123" },
    ])
    const errorMsg = makeAssistantMsg("msg-error", [], {
      name: "APIError",
      data: { message: "messages.39: tool_use without tool_result" },
    })
    const allMessages: MessageData[] = [
      makeUserMsg("msg-user-1"),
      brokenMsg,
      makeUserMsg("msg-user-2"),
      errorMsg,
    ]
    const error = {
      data: { message: "messages.39: tool_use ids were found without tool_result blocks" },
    }

    //#when
    const result = findBrokenMessageByIndex(allMessages, error)

    //#then
    expect(result).toBe(brokenMsg)
  })

  it("#given error without message index #when finding #then returns null", () => {
    //#given
    const allMessages: MessageData[] = [
      makeUserMsg("msg-user-1"),
      makeAssistantMsg("msg-1", [{ type: "text" }]),
    ]
    const error = { data: { message: "some unrelated error" } }

    //#when
    const result = findBrokenMessageByIndex(allMessages, error)

    //#then
    expect(result).toBeNull()
  })

  it("#given no assistant messages with tool parts #when finding #then returns null", () => {
    //#given
    const allMessages: MessageData[] = [
      makeUserMsg("msg-user-1"),
      makeAssistantMsg("msg-1", [{ type: "text" }]),
    ]
    const error = {
      data: { message: "messages.5: tool_use without tool_result" },
    }

    //#when
    const result = findBrokenMessageByIndex(allMessages, error)

    //#then
    expect(result).toBeNull()
  })

  it("#given multiple assistant msgs with tool parts #when finding #then returns the most recent one", () => {
    //#given
    const olderMsg = makeAssistantMsg("msg-older", [
      { type: "tool", callID: "toolu_old" },
    ])
    const newerMsg = makeAssistantMsg("msg-newer", [
      { type: "tool", callID: "toolu_new" },
    ])
    const allMessages: MessageData[] = [
      makeUserMsg("msg-user-1"),
      olderMsg,
      makeUserMsg("msg-user-2"),
      newerMsg,
      makeUserMsg("msg-user-3"),
    ]
    const error = {
      data: { message: "messages.39: tool_use without tool_result" },
    }

    //#when
    const result = findBrokenMessageByIndex(allMessages, error)

    //#then
    expect(result).toBe(newerMsg)
  })

  it("#given assistant error messages mixed in #when finding #then skips error messages", () => {
    //#given
    const brokenMsg = makeAssistantMsg("msg-broken", [
      { type: "tool", callID: "toolu_abc" },
    ])
    const errorMsg = makeAssistantMsg("msg-error", [{ type: "text" }], {
      message: "API error",
    })
    const allMessages: MessageData[] = [
      makeUserMsg("msg-user-1"),
      brokenMsg,
      errorMsg,
    ]
    const error = {
      data: { message: "messages.3: tool_use without tool_result" },
    }

    //#when
    const result = findBrokenMessageByIndex(allMessages, error)

    //#then
    expect(result).toBe(brokenMsg)
  })
})
