const { describe, expect, test } = require("bun:test")

import { unsafeTestValue } from "../../../test-support/unsafe-test-value"
import { extractAssistantText, spawnVoter } from "./voter-spawner"
import type { PluginInput } from "@opencode-ai/plugin"

describe("extractAssistantText", () => {
  test("#given mixed message shapes #when extracting voter output #then the latest assistant text is returned", () => {
    const text = extractAssistantText([
      { info: { role: "assistant" }, parts: [{ type: "text", text: "older" }] },
      { info: { role: "user" }, parts: [{ type: "text", text: "question" }] },
      null,
      { info: { role: "assistant" }, parts: [{ type: "tool" }, { type: "text", text: " latest " }] },
    ])

    expect(text).toBe("latest")
  })

  test("#given no assistant text parts #when extracting voter output #then an empty string is returned", () => {
    const text = extractAssistantText([
      { info: { role: "assistant" }, parts: [{ type: "tool", text: "ignored" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "   " }] },
    ])

    expect(text).toBe("")
  })
})

describe("spawnVoter", () => {
  test("#given a voter times out #when cleaning up session tracking #then the child session remains inspectable", async () => {
    let deletedSessionID: string | undefined
    const ctx = unsafeTestValue<PluginInput>({
      client: {
        session: {
          create: async () => ({ data: { id: "voter-session" } }),
          prompt: async () => ({ data: {} }),
          status: async () => ({ data: {} }),
          messages: async () => ({ data: [] }),
          delete: async (input: { path: { id: string } }) => {
            deletedSessionID = input.path.id
            return { data: {} }
          },
        },
      },
    })

    const result = await spawnVoter(ctx, {
      candidate: {
        lineage: "gpt",
        providerID: "openai",
        modelID: "gpt-5.5",
        variant: undefined,
      },
      prompt: "Pick an architecture.",
      parentSessionID: "parent",
      parentDirectory: "/workspace",
      voterTimeoutMs: 0,
    })

    expect(result.status).toBe("timeout")
    expect(deletedSessionID).toBeUndefined()
  })
})
