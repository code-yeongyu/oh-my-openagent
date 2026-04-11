import { describe, expect, test } from "bun:test"
import { injectContinuationPrompt } from "./continuation-prompt-injector"

describe("ralph-loop continuation prompt injector", () => {
  test("#given inherited message model includes variant #when injecting continuation prompt #then promptAsync receives variant as a top-level field", async () => {
    // given
    let promptBody:
      | {
          model?: { providerID: string; modelID: string }
          variant?: string
        }
      | undefined
    const model = {
      providerID: "openai",
      modelID: "gpt-5.3-codex",
      variant: "max",
    }
    const ctx = {
      client: {
        session: {
          messages: async () => ({
            data: [{ info: { agent: "sisyphus", model } }],
          }),
          promptAsync: async (input: {
            body: {
              model?: { providerID: string; modelID: string }
              variant?: string
            }
          }) => {
            promptBody = input.body
            return {}
          },
        },
      },
    }

    // when
    await injectContinuationPrompt(ctx as never, {
      sessionID: "ses_ralph_variant",
      prompt: "continue",
      directory: "/tmp/test",
      apiTimeoutMs: 50,
    })

    // then
    expect(promptBody?.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.3-codex",
    })
    expect(promptBody?.variant).toBe("max")
  })
})
