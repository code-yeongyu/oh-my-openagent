import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"

import {
  isBoulderPausedForSession,
  setBoulderPause,
  writeBoulderState,
} from "../../features/boulder-state"
import { OMO_INTERNAL_INITIATOR_MARKER } from "../../shared/internal-initiator-marker"
import { createAtlasEventHandler } from "./event-handler"
import type { SessionState } from "./types"

function unsafeTestValue<T>(value: unknown): T {
  return value as T
}

describe("createAtlasEventHandler message correlation", () => {
  const directories: string[] = []

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  function createPausedHandler(sessionID: string) {
    const directory = mkdtempSync(join(tmpdir(), "atlas-message-race-"))
    directories.push(directory)
    writeBoulderState(directory, {
      active_plan: join(directory, "plan.md"),
      plan_name: "plan",
      started_at: "2026-07-27T00:00:00.000Z",
      session_ids: [sessionID],
    })
    setBoulderPause(directory, { reason: "final_wave_approval", sessionId: sessionID })
    const handler = createAtlasEventHandler({
      ctx: unsafeTestValue<PluginInput>({ directory }),
      sessions: new Map<string, SessionState>(),
      getState: () => ({ promptFailureCount: 0 }),
    })
    const isPaused = () => isBoulderPausedForSession(directory, {
      reason: "final_wave_approval",
      sessionId: sessionID,
    })
    return { handler, isPaused }
  }

  test("#given human and internal headers interleave #when the human part arrives first #then human approval still clears the pause", async () => {
    // given
    const sessionID = "atlas-human-first-session"
    const humanMessageID = "msg-human-first"
    const internalMessageID = "msg-internal-second"
    const { handler, isPaused } = createPausedHandler(sessionID)
    await handler({ event: {
      type: "message.updated",
      properties: { sessionID, info: { id: humanMessageID, role: "user" } },
    } })
    await handler({ event: {
      type: "message.updated",
      properties: { sessionID, info: { id: internalMessageID, role: "user" } },
    } })

    // when
    await handler({ event: {
      type: "message.part.updated",
      properties: {
        sessionID,
        part: { messageID: humanMessageID, type: "text", text: "Approve the final wave." },
      },
    } })

    // then
    expect(isPaused()).toBe(false)
  })

  test("#given internal and human headers interleave #when their parts arrive in header order #then only human approval clears the pause", async () => {
    // given
    const sessionID = "atlas-internal-first-session"
    const internalMessageID = "msg-internal-first"
    const humanMessageID = "msg-human-second"
    const { handler, isPaused } = createPausedHandler(sessionID)
    await handler({ event: {
      type: "message.updated",
      properties: { sessionID, info: { id: internalMessageID, role: "user" } },
    } })
    await handler({ event: {
      type: "message.updated",
      properties: { sessionID, info: { id: humanMessageID, role: "user" } },
    } })

    // when
    await handler({ event: {
      type: "message.part.updated",
      properties: {
        sessionID,
        part: {
          messageID: internalMessageID,
          type: "text",
          text: `Keep working.\n${OMO_INTERNAL_INITIATOR_MARKER}`,
        },
      },
    } })

    // then
    expect(isPaused()).toBe(true)

    // when
    await handler({ event: {
      type: "message.part.updated",
      properties: {
        sessionID,
        part: { messageID: humanMessageID, type: "text", text: "Approve the final wave." },
      },
    } })

    // then
    expect(isPaused()).toBe(false)
  })

  test("#given a malformed complete user event #when no real text part is identifiable #then preserves the pause", async () => {
    // given
    const sessionID = "atlas-malformed-user-session"
    const { handler, isPaused } = createPausedHandler(sessionID)

    // when
    await handler({ event: {
      type: "message.updated",
      properties: {
        sessionID,
        info: { id: "msg-malformed-user", role: "user" },
        parts: [{}],
      },
    } })

    // then
    expect(isPaused()).toBe(true)
  })

  test("#given an oversized message ID #when its real text part arrives #then preserves the pause", async () => {
    // given
    const sessionID = "atlas-oversized-message-session"
    const messageID = `msg-${"x".repeat(256)}`
    const { handler, isPaused } = createPausedHandler(sessionID)
    await handler({ event: {
      type: "message.updated",
      properties: { sessionID, info: { id: messageID, role: "user" } },
    } })

    // when
    await handler({ event: {
      type: "message.part.updated",
      properties: {
        sessionID,
        part: { messageID, type: "text", text: "Approve the final wave." },
      },
    } })

    // then
    expect(isPaused()).toBe(true)
  })

  test("#given more than 64 pending IDs #when the oldest part arrives #then evicts it but retains the newest approval", async () => {
    // given
    const sessionID = "atlas-pending-cap-session"
    const { handler, isPaused } = createPausedHandler(sessionID)
    for (let index = 0; index < 65; index += 1) {
      await handler({ event: {
        type: "message.updated",
        properties: { sessionID, info: { id: `msg-${index}`, role: "user" } },
      } })
    }

    // when
    await handler({ event: {
      type: "message.part.updated",
      properties: {
        sessionID,
        part: { messageID: "msg-0", type: "text", text: "Stale approval." },
      },
    } })

    // then
    expect(isPaused()).toBe(true)

    // when
    await handler({ event: {
      type: "message.part.updated",
      properties: {
        sessionID,
        part: { messageID: "msg-64", type: "text", text: "Current approval." },
      },
    } })

    // then
    expect(isPaused()).toBe(false)
  })

  test("#given an attachment precedes approval text #when both parts arrive #then retains correlation until the text clears", async () => {
    // given
    const sessionID = "atlas-multipart-session"
    const messageID = "msg-multipart"
    const { handler, isPaused } = createPausedHandler(sessionID)
    await handler({ event: {
      type: "message.updated",
      properties: { info: { id: messageID, role: "user", sessionID } },
    } })

    // when
    await handler({ event: {
      type: "message.part.updated",
      properties: {
        part: {
          messageID,
          sessionID,
          type: "text",
          text: "Called the Read tool with the following input",
          synthetic: true,
        },
      },
    } })
    await handler({ event: {
      type: "message.part.updated",
      properties: {
        part: { messageID, sessionID, type: "file" },
      },
    } })

    // then
    expect(isPaused()).toBe(true)

    // when
    await handler({ event: {
      type: "message.part.updated",
      properties: {
        part: { messageID, sessionID, type: "text", text: "Approve the final wave." },
      },
    } })

    // then
    expect(isPaused()).toBe(false)
  })
})
