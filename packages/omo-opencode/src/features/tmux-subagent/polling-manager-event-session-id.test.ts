import { describe, expect, test } from "bun:test"

import { TmuxPollingManager } from "./polling-manager"
import type { TrackedSession } from "./types"

describe("TmuxPollingManager event session ids", () => {
  test("#given legacy message.part.updated properties #when handling activity #then part session id increments activity version", () => {
    const sessions = new Map<string, TrackedSession>()
    sessions.set("ses-part-only", {
      sessionId: "ses-part-only",
      paneId: "%1",
      description: "test",
      createdAt: new Date(),
      lastSeenAt: new Date(),
      closePending: false,
      closeRetryCount: 0,
      activityVersion: 0,
    })

    const client = {
      session: {
        status: async () => ({ data: {} }),
        messages: async () => ({ data: [] }),
      },
    }
    const manager = new TmuxPollingManager(client as never, sessions, async () => {})

    manager.handleEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          messageID: "msg-1",
          sessionID: "ses-part-only",
          type: "text",
          text: "working",
        },
      },
    })

    expect(sessions.get("ses-part-only")?.activityVersion).toBe(1)
  })
})
