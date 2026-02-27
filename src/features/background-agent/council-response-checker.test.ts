import { describe, it, expect, mock } from "bun:test"

import { sessionHasCouncilResponse } from "./council-response-checker"

function createMockClient(
  messages: Array<{ info?: { role?: string }; parts?: Array<{ type?: string; text?: string }> }>,
) {
  return {
    session: {
      messages: mock(() => Promise.resolve(messages)),
    },
  } as any
}

describe("sessionHasCouncilResponse", () => {
  describe("#given assistant message with closing council tag", () => {
    it("#when tag is in text part #then should return true", async () => {
      //#given
      const client = createMockClient([
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "Some response</COUNCIL_MEMBER_RESPONSE>" }],
        },
      ])

      //#when
      const result = await sessionHasCouncilResponse(client, "ses-1")

      //#then
      expect(result).toBe(true)
    })
  })

  describe("#given empty messages array", () => {
    it("#when no messages exist #then should return false", async () => {
      //#given
      const client = createMockClient([])

      //#when
      const result = await sessionHasCouncilResponse(client, "ses-empty")

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given only user messages", () => {
    it("#when no assistant messages exist #then should return false", async () => {
      //#given
      const client = createMockClient([
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "Hello" }],
        },
      ])

      //#when
      const result = await sessionHasCouncilResponse(client, "ses-user-only")

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given assistant messages without the closing tag", () => {
    it("#when tag is absent #then should return false", async () => {
      //#given
      const client = createMockClient([
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "Just a regular assistant response" }],
        },
      ])

      //#when
      const result = await sessionHasCouncilResponse(client, "ses-no-tag")

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given user message containing the closing tag", () => {
    it("#when only user has the tag #then should return false", async () => {
      //#given
      const client = createMockClient([
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "Here is the tag: </COUNCIL_MEMBER_RESPONSE>" }],
        },
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "I see your message" }],
        },
      ])

      //#when
      const result = await sessionHasCouncilResponse(client, "ses-user-tag")

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given assistant message with tag buried in longer text", () => {
    it("#when tag appears mid-text #then should return true", async () => {
      //#given
      const client = createMockClient([
        {
          info: { role: "assistant" },
          parts: [
            {
              type: "text",
              text: "Here is my analysis of the situation.\n\nLong content here.\n\n</COUNCIL_MEMBER_RESPONSE>\n\nMore text after.",
            },
          ],
        },
      ])

      //#when
      const result = await sessionHasCouncilResponse(client, "ses-buried-tag")

      //#then
      expect(result).toBe(true)
    })
  })

  describe("#given API call throws an error", () => {
    it("#when client rejects #then should return false", async () => {
      //#given
      const client = {
        session: {
          messages: mock(() => Promise.reject(new Error("API error"))),
        },
      } as any

      //#when
      const result = await sessionHasCouncilResponse(client, "ses-error")

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given messages with missing or undefined parts", () => {
    it("#when parts are undefined #then should handle gracefully and return false", async () => {
      //#given
      const client = createMockClient([
        {
          info: { role: "assistant" },
          parts: undefined,
        },
        {
          info: { role: "assistant" },
        },
      ])

      //#when
      const result = await sessionHasCouncilResponse(client, "ses-no-parts")

      //#then
      expect(result).toBe(false)
    })
  })
})
