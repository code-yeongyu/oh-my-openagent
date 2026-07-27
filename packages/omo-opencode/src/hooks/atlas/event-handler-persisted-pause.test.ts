import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import {
  isBoulderPausedForSession,
  setBoulderPause,
  writeBoulderState,
} from "../../features/boulder-state"
import { OMO_INTERNAL_INITIATOR_MARKER } from "../../shared/internal-initiator-marker"
import { createAtlasEventHandler } from "./event-handler"
import type { SessionState } from "./types"

describe("createAtlasEventHandler persisted final-wave pause", () => {
  let directory: string | undefined

  afterEach(() => {
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function createPausedHandler(sessionID: string) {
    directory = mkdtempSync(join(tmpdir(), "atlas-persisted-pause-"))
    writeBoulderState(directory, {
      active_plan: join(directory, "plan.md"),
      plan_name: "plan",
      started_at: "2026-07-20T00:00:00.000Z",
      session_ids: [sessionID],
    })
    setBoulderPause(directory, {
      reason: "final_wave_approval",
      sessionId: sessionID,
    })
    return createAtlasEventHandler({
      ctx: unsafeTestValue<PluginInput>({ directory }),
      sessions: new Map<string, SessionState>(),
      getState: () => ({ promptFailureCount: 0 }),
    })
  }

  function finalWavePauseIsActive(sessionID: string): boolean {
    if (directory === undefined) {
      return false
    }
    return isBoulderPausedForSession(directory, {
      reason: "final_wave_approval",
      sessionId: sessionID,
    })
  }

  test("#given a persisted pause after restart #when a complete real user message arrives #then clears the pause", async () => {
    // given
    const sessionID = "atlas-restarted-final-wave-session"
    const handler = createPausedHandler(sessionID)

    // when
    await handler({
      event: {
        type: "message.updated",
        properties: {
          sessionID,
          info: { id: "msg-real-user", role: "user" },
          parts: [{ type: "text", text: "Continue the final wave." }],
        },
      },
    })

    // then
    expect(finalWavePauseIsActive(sessionID)).toBe(false)
  })

  test("#given a persisted pause after restart #when a complete internal user message arrives #then preserves the pause", async () => {
    // given
    const sessionID = "atlas-internal-final-wave-session"
    const handler = createPausedHandler(sessionID)

    // when
    await handler({
      event: {
        type: "message.updated",
        properties: {
          sessionID,
          info: { id: "msg-internal-user", role: "user" },
          parts: [{ type: "text", text: `Keep working.\n${OMO_INTERNAL_INITIATOR_MARKER}` }],
        },
      },
    })

    // then
    expect(finalWavePauseIsActive(sessionID)).toBe(true)
  })

  test("#given a persisted pause after restart #when an internal user message arrives as split events #then preserves the pause", async () => {
    // given
    const sessionID = "atlas-split-internal-final-wave-session"
    const messageID = "msg-split-internal-user"
    const handler = createPausedHandler(sessionID)

    // when
    await handler({
      event: {
        type: "message.updated",
        properties: { sessionID, info: { id: messageID, role: "user" } },
      },
    })
    await handler({
      event: {
        type: "message.part.updated",
        properties: {
          sessionID,
          part: {
            messageID,
            type: "text",
            text: `Keep working.\n${OMO_INTERNAL_INITIATOR_MARKER}`,
          },
        },
      },
    })

    // then
    expect(finalWavePauseIsActive(sessionID)).toBe(true)
  })

  test("#given a persisted pause after restart #when a real user message arrives as split events #then clears only after the part arrives", async () => {
    // given
    const sessionID = "atlas-split-real-final-wave-session"
    const messageID = "msg-split-real-user"
    const handler = createPausedHandler(sessionID)

    // when
    await handler({
      event: {
        type: "message.updated",
        properties: { sessionID, info: { id: messageID, role: "user" } },
      },
    })

    // then
    expect(finalWavePauseIsActive(sessionID)).toBe(true)

    // when
    await handler({
      event: {
        type: "message.part.updated",
        properties: {
          sessionID,
          part: { messageID, type: "text", text: "Continue the final wave." },
        },
      },
    })

    // then
    expect(finalWavePauseIsActive(sessionID)).toBe(false)
  })
})
