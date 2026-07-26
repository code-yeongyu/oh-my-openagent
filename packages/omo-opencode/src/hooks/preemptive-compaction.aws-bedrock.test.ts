/// <reference types="bun-types" />

import { describe, expect, it, mock } from "bun:test"

import { OhMyOpenCodeConfigSchema } from "../config"

const { createPreemptiveCompactionHook } = await import("./preemptive-compaction")

type HookContext = Parameters<typeof createPreemptiveCompactionHook>[0]

function createMockContext(): HookContext {
  return {
    client: {
      session: {
        messages: mock(() => Promise.resolve({ data: [] })),
        summarize: mock(() => Promise.resolve({})),
      },
      tui: {
        showToast: mock(() => Promise.resolve()),
      },
    },
    directory: "/tmp/test",
  }
}

describe("preemptive-compaction Bedrock providers", () => {
  it("uses the GA 1M threshold for OpenCode's Amazon Bedrock provider ID", async () => {
    // given
    const ctx = createMockContext()
    const pluginConfig = OhMyOpenCodeConfigSchema.parse({})
    const hook = createPreemptiveCompactionHook(ctx, pluginConfig)
    const sessionID = "ses_aws_bedrock_opus_5"
    const sendUsage = async (input: number, callID: string): Promise<void> => {
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              role: "assistant",
              sessionID,
              providerID: "amazon-bedrock",
              modelID: "us.anthropic.claude-opus-5",
              finish: true,
              tokens: {
                input,
                output: 1_000,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        },
      })
      await hook["tool.execute.after"](
        { tool: "bash", sessionID, callID },
        { title: "", output: "test", metadata: null },
      )
    }

    // when
    await sendUsage(200_000, "call_aws_bedrock_below")

    // then
    expect(ctx.client.session.summarize).not.toHaveBeenCalled()

    // when
    await sendUsage(790_000, "call_aws_bedrock_above")

    // then
    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1)
  })

  it("triggers compaction for aws-bedrock-anthropic provider when usage exceeds threshold", async () => {
    // given
    const ctx = createMockContext()
    const pluginConfig = OhMyOpenCodeConfigSchema.parse({})
    const hook = createPreemptiveCompactionHook(ctx, pluginConfig)
    const sessionID = "ses_aws_bedrock_anthropic_high"

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID,
            providerID: "aws-bedrock-anthropic",
            modelID: "claude-sonnet-4-6",
            finish: true,
            tokens: {
              input: 800000,
              output: 1000,
              reasoning: 0,
              cache: { read: 10000, write: 0 },
            },
          },
        },
      },
    })

    // when
    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_aws_bedrock_1" },
      { title: "", output: "test", metadata: null },
    )

    // then
    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1)
  })
})
