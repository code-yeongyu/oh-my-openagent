import { describe, expect, it, mock } from "bun:test"
import {
  isStepOnlyNoTextParts,
  resolveNoTextTailFromSession,
} from "./preemptive-compaction-no-text-tail"

describe("isStepOnlyNoTextParts", () => {
  //#given empty array
  //#when checking
  //#then returns false
  it("returns false for empty array", () => {
    expect(isStepOnlyNoTextParts([])).toBe(false)
  })

  //#given non-array
  //#when checking
  //#then returns false
  it("returns false for non-array", () => {
    expect(isStepOnlyNoTextParts(null)).toBe(false)
    expect(isStepOnlyNoTextParts("string")).toBe(false)
    expect(isStepOnlyNoTextParts(42)).toBe(false)
  })

  //#given parts with only step-start and step-finish types
  //#when checking
  //#then returns true
  it("returns true for step-only parts without text", () => {
    const parts = [
      { type: "step-start" },
      { type: "step-finish" },
    ]
    expect(isStepOnlyNoTextParts(parts)).toBe(true)
  })

  //#given parts with text content
  //#when checking
  //#then returns false
  it("returns false when step part has non-empty text", () => {
    const parts = [
      { type: "step-start", text: "some text" },
    ]
    expect(isStepOnlyNoTextParts(parts)).toBe(false)
  })

  //#given parts with non-step type
  //#when checking
  //#then returns false
  it("returns false when part has non-step type", () => {
    const parts = [
      { type: "text", text: "hello" },
    ]
    expect(isStepOnlyNoTextParts(parts)).toBe(false)
  })

  //#given parts with empty text string
  //#when checking
  //#then returns true (empty text is ok)
  it("returns true when step part has empty text", () => {
    const parts = [
      { type: "step-start", text: "   " },
    ]
    expect(isStepOnlyNoTextParts(parts)).toBe(true)
  })
})

describe("resolveNoTextTailFromSession", () => {
  //#given session with assistant message that has only step parts
  //#when resolving
  //#then returns true
  it("returns true when last assistant message has only step parts", async () => {
    const client = {
      session: {
        messages: mock(() =>
          Promise.resolve({
            data: [
              {
                info: { id: "msg1", role: "assistant" },
                parts: [{ type: "step-start" }, { type: "step-finish" }],
              },
            ],
          }),
        ),
      },
    }

    const result = await resolveNoTextTailFromSession({
      client,
      sessionID: "ses_test",
      directory: "/tmp",
    })

    expect(result).toBe(true)
  })

  //#given session with assistant message that has text
  //#when resolving
  //#then returns false
  it("returns false when last assistant message has text parts", async () => {
    const client = {
      session: {
        messages: mock(() =>
          Promise.resolve({
            data: [
              {
                info: { id: "msg1", role: "assistant" },
                parts: [{ type: "text", text: "Hello world" }],
              },
            ],
          }),
        ),
      },
    }

    const result = await resolveNoTextTailFromSession({
      client,
      sessionID: "ses_test",
      directory: "/tmp",
    })

    expect(result).toBe(false)
  })

  //#given session messages fetch throws
  //#when resolving
  //#then returns false (graceful degradation)
  it("returns false when messages fetch throws", async () => {
    const client = {
      session: {
        messages: mock(() => Promise.reject(new Error("network error"))),
      },
    }

    const result = await resolveNoTextTailFromSession({
      client,
      sessionID: "ses_test",
      directory: "/tmp",
    })

    expect(result).toBe(false)
  })

  //#given empty messages response
  //#when resolving
  //#then returns false
  it("returns false when messages array is empty", async () => {
    const client = {
      session: {
        messages: mock(() => Promise.resolve({ data: [] })),
      },
    }

    const result = await resolveNoTextTailFromSession({
      client,
      sessionID: "ses_test",
      directory: "/tmp",
    })

    expect(result).toBe(false)
  })

  //#given last message is user role
  //#when resolving
  //#then returns false
  it("returns false when last message is not assistant", async () => {
    const client = {
      session: {
        messages: mock(() =>
          Promise.resolve({
            data: [
              {
                info: { id: "msg1", role: "user" },
                parts: [{ type: "step-start" }],
              },
            ],
          }),
        ),
      },
    }

    const result = await resolveNoTextTailFromSession({
      client,
      sessionID: "ses_test",
      directory: "/tmp",
    })

    expect(result).toBe(false)
  })
})
