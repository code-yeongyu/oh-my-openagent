import { describe, expect, test } from "bun:test"

import { OMO_INTERNAL_INITIATOR_MARKER } from "../shared"
import { createChatHeadersHandler } from "./chat-headers"

describe("createChatHeadersHandler", () => {
  test("sets x-initiator=agent for Copilot internal synthetic marker messages", async () => {
    const handler = createChatHeadersHandler()
    const output: { headers: Record<string, string> } = { headers: {} }

    await handler(
      {
        provider: { id: "github-copilot" },
        message: {
          info: { role: "user" },
          parts: [
            {
              type: "text",
              text: `notification\n${OMO_INTERNAL_INITIATOR_MARKER}`,
              synthetic: true,
            },
          ],
        },
      },
      output,
    )

    expect(output.headers["x-initiator"]).toBe("agent")
  })

  test("does not override non-copilot providers", async () => {
    const handler = createChatHeadersHandler()
    const output: { headers: Record<string, string> } = { headers: {} }

    await handler(
      {
        provider: { id: "openai" },
        message: {
          info: { role: "user" },
          parts: [
            {
              type: "text",
              text: `notification\n${OMO_INTERNAL_INITIATOR_MARKER}`,
              synthetic: true,
            },
          ],
        },
      },
      output,
    )

    expect(output.headers["x-initiator"]).toBeUndefined()
  })

  test("does not override regular user messages", async () => {
    const handler = createChatHeadersHandler()
    const output: { headers: Record<string, string> } = { headers: {} }

    await handler(
      {
        provider: { id: "github-copilot" },
        message: {
          info: { role: "user" },
          parts: [{ type: "text", text: "normal user message" }],
        },
      },
      output,
    )

    expect(output.headers["x-initiator"]).toBeUndefined()
  })
})
