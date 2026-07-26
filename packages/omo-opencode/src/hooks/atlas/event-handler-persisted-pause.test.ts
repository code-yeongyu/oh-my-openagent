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
import { createAtlasEventHandler } from "./event-handler"
import type { SessionState } from "./types"

describe("createAtlasEventHandler persisted final-wave pause", () => {
  let directory: string | undefined

  afterEach(() => {
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("clears the pause when the first user message arrives after restart", async () => {
    // given
    directory = mkdtempSync(join(tmpdir(), "atlas-persisted-pause-"))
    const sessionID = "atlas-restarted-final-wave-session"
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
    const sessions = new Map<string, SessionState>()
    const handler = createAtlasEventHandler({
      ctx: unsafeTestValue<PluginInput>({ directory }),
      sessions,
      getState: () => ({ promptFailureCount: 0 }),
    })

    // when
    await handler({
      event: {
        type: "message.updated",
        properties: { sessionID, info: { role: "user" } },
      },
    })

    // then
    expect(isBoulderPausedForSession(directory, {
      reason: "final_wave_approval",
      sessionId: sessionID,
    })).toBe(false)
  })
})
