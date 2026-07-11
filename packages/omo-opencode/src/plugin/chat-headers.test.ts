import { SUPPORTED_PROVIDERS } from "@oh-my-opencode/model-core";
import { describe, expect, test } from "bun:test"

import { OMO_INTERNAL_INITIATOR_MARKER } from "../shared"
import { createChatHeadersHandler } from "./chat-headers"

describe("createChatHeadersHandler", () => {
  test("sets x-initiator=agent for Copilot internal marker messages", async () => {
    const handler = createChatHeadersHandler({
      ctx: {
        client: {
          session: {
            message: async () => ({
              data: {
                parts: [
                  {
                    type: "text",
                    text: `notification\n${OMO_INTERNAL_INITIATOR_MARKER}`,
                  },
                ],
              },
            }),
          },
        },
      } as never,
    })
    const output: { headers: Record<string, string> } = { headers: {} }

    await handler(
      {
        sessionID: "ses_1",
        provider: { id: SUPPORTED_PROVIDERS.GITHUB_COPILOT },
        message: {
          id: "msg_1",
          role: "user",
        },
      },
      output,
    )

    expect(output.headers["x-initiator"]).toBe("agent")
  })

  test("does not override non-copilot providers", async () => {
    const handler = createChatHeadersHandler({
      ctx: {
        client: {
          session: {
            message: async () => ({
              data: {
                parts: [
                  {
                    type: "text",
                    text: `notification\n${OMO_INTERNAL_INITIATOR_MARKER}`,
                  },
                ],
              },
            }),
          },
        },
      } as never,
    })
    const output: { headers: Record<string, string> } = { headers: {} }

    await handler(
      {
        sessionID: "ses_1",
        provider: { id: SUPPORTED_PROVIDERS.OPENAI },
        message: {
          id: "msg_2",
          role: "user",
        },
      },
      output,
    )

    expect(output.headers["x-initiator"]).toBeUndefined()
  })

  test("does not override regular user messages", async () => {
    const handler = createChatHeadersHandler({
      ctx: {
        client: {
          session: {
            message: async () => ({
              data: {
                parts: [{ type: "text", text: "normal user message" }],
              },
            }),
          },
        },
      } as never,
    })
    const output: { headers: Record<string, string> } = { headers: {} }

    await handler(
      {
        sessionID: "ses_3",
        provider: { id: SUPPORTED_PROVIDERS.GITHUB_COPILOT },
        message: {
          id: "msg_3",
          role: "user",
        },
      },
      output,
    )

    expect(output.headers["x-initiator"]).toBeUndefined()
  })

  test("skips x-initiator override when model uses @ai-sdk/github-copilot", async () => {
    const handler = createChatHeadersHandler({
      ctx: {
        client: {
          session: {
            message: async () => ({
              data: {
                parts: [
                  {
                    type: "text",
                    text: `notification\n${OMO_INTERNAL_INITIATOR_MARKER}`,
                  },
                ],
              },
            }),
          },
        },
      } as never,
    })
    const output: { headers: Record<string, string> } = { headers: {} }

    await handler(
      {
        sessionID: "ses_4",
        provider: { id: SUPPORTED_PROVIDERS.GITHUB_COPILOT },
        model: { api: { npm: "@ai-sdk/github-copilot" } },
        message: {
          id: "msg_4",
          role: "user",
        },
      },
      output,
    )

    expect(output.headers["x-initiator"]).toBeUndefined()
  })
})
