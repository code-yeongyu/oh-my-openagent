/// <reference types="bun-types" />

import { describe, expect, test, beforeEach } from "bun:test"
import { mkdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { createStartWorkHook, _resetProcessedSessionsForTesting } from "./start-work-hook"
import * as sessionState from "../../features/claude-code-session-state"
import { clearBoulderState } from "../../features/boulder-state"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"

describe("start-work hook deduplication", () => {
  let testDir: string

  function createMockPluginInput() {
    return {
      directory: testDir,
      client: {
        session: {
          messages: async () => ({ data: [] }),
        },
      },
    } as Parameters<typeof createStartWorkHook>[0]
  }

  function createStartWorkOutput() {
    return {
      parts: [{
        type: "text",
        text: `<command-instruction>
You are starting a Sisyphus work session.
</command-instruction>

<session-context>
Session ID: $SESSION_ID
Timestamp: $TIMESTAMP
</session-context>`,
      }],
      message: { agent: "sisyphus" },
    }
  }

  beforeEach(() => {
    _resetProcessedSessionsForTesting()
    sessionState._resetForTesting()
    sessionState.registerAgentName("atlas")
    sessionState.registerAgentName("sisyphus")
    testDir = join(tmpdir(), `start-work-dedup-test-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
    mkdirSync(join(testDir, ".omo"), { recursive: true })
    clearBoulderState(testDir)
  })

  test("#given same session called twice #when error retry #then second call is skipped", async () => {
    // given
    const hook = createStartWorkHook(createMockPluginInput())
    const sessionID = "session-dedup-test"
    const output1 = createStartWorkOutput()
    const output2 = createStartWorkOutput()

    // when - first call processes normally
    await hook["chat.message"]({ sessionID }, output1)

    // then - first call should have injected context (replaced $SESSION_ID)
    expect(output1.parts[0].text).not.toContain("$SESSION_ID")
    expect(output1.parts[0].text).toContain(sessionID)

    // when - second call (error retry) should be skipped
    await hook["chat.message"]({ sessionID }, output2)

    // then - second output should remain unchanged (still has $SESSION_ID literal)
    expect(output2.parts[0].text).toContain("$SESSION_ID")
    expect(output2.parts[0].text).not.toContain(sessionID)
  })

  test("#given different sessions #when both call hook #then both are processed", async () => {
    // given
    const hook = createStartWorkHook(createMockPluginInput())
    const output1 = createStartWorkOutput()
    const output2 = createStartWorkOutput()

    // when
    await hook["chat.message"]({ sessionID: "session-A" }, output1)
    await hook["chat.message"]({ sessionID: "session-B" }, output2)

    // then - both should have been processed (replaced $SESSION_ID)
    expect(output1.parts[0].text).toContain("session-A")
    expect(output2.parts[0].text).toContain("session-B")
  })

  test("#given command.execute.before handler #when same session retries #then second call is skipped", async () => {
    // given
    const hook = createStartWorkHook(createMockPluginInput())
    const sessionID = "session-cmd-dedup"
    const output1 = createStartWorkOutput()
    const output2 = createStartWorkOutput()

    // when - first call via command.execute.before
    await hook["command.execute.before"](
      { sessionID, command: "start-work", arguments: "" },
      output1,
    )

    // then - first call processed
    expect(output1.parts[0].text).toContain(sessionID)

    // when - retry via chat.message (same session)
    await hook["chat.message"]({ sessionID }, output2)

    // then - second call skipped
    expect(output2.parts[0].text).toContain("$SESSION_ID")
  })
})
