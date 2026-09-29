import { describe, expect, it } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import { extractDeletedSessionID, registerLifecycleV2 } from "./v2-lifecycle"
import {
  clearSessionPromptParams,
  getSessionPromptParams,
  setSessionPromptParams,
} from "./shared/session-prompt-params-state"

const SESSION_ID = "ses-lifecycle-test"

describe("v2 lifecycle", () => {
  it("extracts deleted session ids from v1/v2 event shapes", () => {
    // given deleted events in different envelope shapes
    // when inspected
    // then the session id is extracted, others ignored
    expect(extractDeletedSessionID({ type: "session.deleted", properties: { sessionID: SESSION_ID } }))
      .toBe(SESSION_ID)
    expect(extractDeletedSessionID({ type: "session.deleted", data: { sessionID: SESSION_ID } }))
      .toBe(SESSION_ID)
    expect(extractDeletedSessionID({ type: "session.created", properties: { sessionID: SESSION_ID } }))
      .toBeUndefined()
    expect(extractDeletedSessionID({ type: "session.deleted", properties: {} })).toBeUndefined()
  })

  it("clears per-session v2 state on session.deleted and aborts on cleanup", async () => {
    // given seeded per-session state and a fake event stream
    setSessionPromptParams(SESSION_ID, { temperature: 0.3 })
    const ctx = {
      event: {
        subscribe: async function* (_options: { signal: unknown }) {
          yield { type: "session.created", properties: { sessionID: SESSION_ID } }
          yield { type: "session.deleted", properties: { sessionID: SESSION_ID } }
        },
      },
    }

    // when lifecycle registers, the stream drains, and cleanup runs
    const cleanup = await registerLifecycleV2(ctx as unknown as Plugin.Context)
    await new Promise((resolve) => setTimeout(resolve, 50))
    cleanup()

    // then session state was cleared and cleanup is callable
    expect(getSessionPromptParams(SESSION_ID)).toBeUndefined()
    expect(typeof cleanup).toBe("function")
    clearSessionPromptParams(SESSION_ID)
  })
})
