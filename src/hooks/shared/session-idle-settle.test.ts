import { describe, expect, test } from "bun:test"

import {
  isSessionActive,
  shouldPromptAfterSessionIdle,
} from "./session-idle-settle"

describe("session idle prompt guard", () => {
  test("#given session.status reports busy #when checking active session #then it returns true", async () => {
    // given
    const client = {
      session: {
        status: async () => ({
          data: {
            "ses-active": { type: "busy" },
          },
        }),
      },
    }

    // when
    const active = await isSessionActive(client, "ses-active")

    // then
    expect(active).toBe(true)
  })

  test("#given a stale idle event but session became busy #when settling before prompt #then it blocks the wake", async () => {
    // given
    const client = {
      session: {
        status: async () => ({
          "ses-active": { type: "busy" },
        }),
      },
    }

    // when
    const shouldPrompt = await shouldPromptAfterSessionIdle(client, "ses-active", 0)

    // then
    expect(shouldPrompt).toBe(false)
  })

  test("#given session.status is unavailable #when settling before prompt #then it preserves legacy prompt behavior", async () => {
    // given
    const client = { session: {} }

    // when
    const shouldPrompt = await shouldPromptAfterSessionIdle(client, "ses-legacy", 0)

    // then
    expect(shouldPrompt).toBe(true)
  })
})
