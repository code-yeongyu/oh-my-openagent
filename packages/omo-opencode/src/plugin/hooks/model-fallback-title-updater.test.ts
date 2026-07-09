/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { PluginContext } from "../types"
import { createModelFallbackTitleUpdater } from "./model-fallback-title-updater"

describe("model fallback title updater", () => {
  test("restores the base title when a pending fallback is cleared", async () => {
    const updates: string[] = []
    let title = "Atlas task"
    const updater = createModelFallbackTitleUpdater(unsafeTestValue<PluginContext>({
      directory: "/tmp/project",
      client: {
        session: {
          get: async () => ({ data: { title } }),
          update: async ({ body }: { body: { title: string } }) => {
            title = body.title
            updates.push(body.title)
          },
        },
      },
    }))

    await updater({
      sessionID: "ses_title_clear",
      providerID: "openai",
      modelID: "gpt-5.5",
      variant: "high",
    })
    expect(title).toBe("Atlas task [fallback: openai/gpt-5.5 high]")

    await updater.clear({ sessionID: "ses_title_clear" })

    expect(title).toBe("Atlas task")
    expect(updates).toEqual([
      "Atlas task [fallback: openai/gpt-5.5 high]",
      "Atlas task",
    ])
  })

  test("strips an existing fallback marker even when updater state was lost", async () => {
    const updates: string[] = []
    let title = "Atlas task [fallback: openai/gpt-5.5 high]"
    const updater = createModelFallbackTitleUpdater(unsafeTestValue<PluginContext>({
      directory: "/tmp/project",
      client: {
        session: {
          get: async () => ({ data: { title } }),
          update: async ({ body }: { body: { title: string } }) => {
            title = body.title
            updates.push(body.title)
          },
        },
      },
    }))

    await updater.clear({ sessionID: "ses_title_clear_state_lost" })

    expect(title).toBe("Atlas task")
    expect(updates).toEqual(["Atlas task"])
  })
})
