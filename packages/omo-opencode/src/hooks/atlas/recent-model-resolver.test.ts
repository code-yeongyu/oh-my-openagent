import { SUPPORTED_PROVIDERS, SUPPORTED_MODELS } from "@oh-my-opencode/model-core";
import { describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { resolveRecentPromptContextForSession } from "./recent-model-resolver"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

describe("resolveRecentPromptContextForSession", () => {
  test("uses message time.created rather than SDK array order for recent prompt context", async () => {
    // given
    const ctx = unsafeTestValue<PluginInput>({
      client: {
        session: {
          messages: mock(async () => ({
            data: [
              {
                id: "msg_newer_in_array",
                info: {
                  providerID: SUPPORTED_PROVIDERS.ANTHROPIC,
                  modelID: SUPPORTED_MODELS.CLAUDE_SONNET_4_6,
                  tools: { read: true },
                  time: { created: 10 },
                },
              },
              {
                id: "msg_older_in_array",
                info: {
                  providerID: SUPPORTED_PROVIDERS.OPENAI,
                  modelID: SUPPORTED_MODELS.GPT_5_4,
                  tools: { edit: true },
                  time: { created: 100 },
                },
              },
            ],
          })),
        },
      },
    })

    // when
    const result = await resolveRecentPromptContextForSession(ctx, "ses_123")

    // then
    expect(result.model).toEqual({ providerID: SUPPORTED_PROVIDERS.OPENAI, modelID: SUPPORTED_MODELS.GPT_5_4 })
    expect(result.tools).toEqual({ edit: true })
  })
})
