import { describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { resolveRecentPromptContextForSession } from "./recent-model-resolver"

describe("resolveRecentPromptContextForSession", () => {
  test("uses message time.created rather than SDK array order for recent prompt context", async () => {
    // given
    const ctx = {
      client: {
        session: {
          messages: mock(async () => ({
            data: [
              {
                id: "msg_newer_in_array",
                info: {
                  providerID: "anthropic",
                  modelID: "claude-sonnet-4-6",
                  tools: { read: true },
                  time: { created: 10 },
                },
              },
              {
                id: "msg_older_in_array",
                info: {
                  providerID: "openai",
                  modelID: "gpt-5.4",
                  tools: { edit: true },
                  time: { created: 100 },
                },
              },
            ],
          })),
        },
      },
    } as unknown as PluginInput

    // when
    const result = await resolveRecentPromptContextForSession(ctx, "ses_123")

    // then
    expect(result.model).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
    expect(result.tools).toEqual({ edit: true })
  })
})
