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

describe("preemptive-compaction aws-bedrock-anthropic", () => {
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
              input: 170000,
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
