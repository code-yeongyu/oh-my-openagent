/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import type { PluginInput } from "@opencode-ai/plugin"

import { BackgroundManager } from "./manager"

async function waitForEvent(events: readonly string[], eventName: string): Promise<void> {
  const deadlineAt = Date.now() + 1_000
  while (!events.includes(eventName)) {
    if (Date.now() > deadlineAt) {
      throw new Error(`timed out waiting for ${eventName}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe("BackgroundManager session created callback", () => {
  test("fires onSessionCreated before the launch prompt is sent", async () => {
    //#given
    const events: string[] = []
    const client = {
      session: {
        get: async ({ path }: { path: { id: string } }) => ({
          data: { id: path.id, directory: tmpdir() },
        }),
        create: async () => {
          events.push("session.create")
          return { data: { id: "child-session" } }
        },
        promptAsync: async () => {
          events.push("promptAsync")
          return { data: {} }
        },
      },
    }
    const manager = new BackgroundManager({
      pluginContext: { client, directory: tmpdir() } as PluginInput,
    })

    //#when
    await manager.launch({
      description: "Create child",
      prompt: "Do work",
      agent: "general",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
      onSessionCreated: (sessionId) => {
        events.push(`onSessionCreated:${sessionId}`)
      },
    })
    await waitForEvent(events, "promptAsync")

    //#then
    expect(events).toEqual([
      "session.create",
      "onSessionCreated:child-session",
      "promptAsync",
    ])

    manager.shutdown()
  })
})
