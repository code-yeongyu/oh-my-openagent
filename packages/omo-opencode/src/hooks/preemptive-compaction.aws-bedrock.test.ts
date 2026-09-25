/// <reference types="bun-types" />

import { afterEach, describe, expect, it, mock } from "bun:test"

import { OhMyOpenCodeConfigSchema } from "../config"

const { createPreemptiveCompactionHook } = await import("./preemptive-compaction")

const originalAnthropicContextEnv = process.env.ANTHROPIC_1M_CONTEXT
const originalVertexContextEnv = process.env.VERTEX_ANTHROPIC_1M_CONTEXT

afterEach(() => {
  if (originalAnthropicContextEnv === undefined) delete process.env.ANTHROPIC_1M_CONTEXT
  else process.env.ANTHROPIC_1M_CONTEXT = originalAnthropicContextEnv

  if (originalVertexContextEnv === undefined) delete process.env.VERTEX_ANTHROPIC_1M_CONTEXT
  else process.env.VERTEX_ANTHROPIC_1M_CONTEXT = originalVertexContextEnv
})

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

  it("uses the cached 200K limit for Amazon Bedrock Claude models despite Anthropic 1M flags", async () => {
    // given
    process.env.ANTHROPIC_1M_CONTEXT = "true"
    process.env.VERTEX_ANTHROPIC_1M_CONTEXT = "true"
    const ctx = createMockContext()
    const pluginConfig = OhMyOpenCodeConfigSchema.parse({})
    const modelID = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    const hook = createPreemptiveCompactionHook(ctx, pluginConfig, {
      anthropicContext1MEnabled: true,
      modelContextLimitsCache: new Map([[`amazon-bedrock/${modelID}`, 200_000]]),
    })
    const sessionID = "ses_amazon_bedrock_haiku_200k"

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID,
            providerID: "amazon-bedrock",
            modelID,
            finish: true,
            tokens: {
              input: 160_000,
              output: 1_000,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        },
      },
    })

    // when
    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_amazon_bedrock_haiku" },
      { title: "", output: "test", metadata: null },
    )

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
