import { describe, expect, it } from "bun:test"

import { _resetForTesting, subagentSessions } from "../../features/claude-code-session-state/state"
import { createToolPairValidatorHook } from "./hook"
import { INTERRUPTED_TOOL_ERROR } from "./tool-result-repair"
import { createToolPart, runToolPairValidator, type TestMessage } from "./hook.test-support"

describe("createToolPairValidatorHook", () => {
  describe("#given an assistant turn whose tool parts already reached a terminal state", () => {
    it("#then leaves completed and errored tool parts untouched", async () => {
      // given
      const messages: TestMessage[] = [
        {
          info: { role: "assistant" },
          parts: [
            createToolPart({ callID: "call_completed", status: "completed", output: "OK" }),
            createToolPart({ callID: "call_error", status: "error", error: "File not found" }),
          ],
        },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "final answer" }] },
      ]
      const before = structuredClone(messages)

      // when
      await runToolPairValidator(createToolPairValidatorHook(), messages)

      // then
      expect(messages).toEqual(before)
    })
  })

  describe("#given an assistant turn holding a running tool part", () => {
    it("#then settles that part into a terminal error state in place", async () => {
      // given
      const messages: TestMessage[] = [
        {
          info: { role: "assistant", id: "msg_1" },
          parts: [
            { type: "text", text: "working" },
            createToolPart({ callID: "toolu_running", status: "running", start: 1000 }),
          ],
        },
      ]

      // when
      await runToolPairValidator(createToolPairValidatorHook(), messages)

      // then
      const repaired = messages[0]?.parts[1] as { state: Record<string, unknown> }
      expect(repaired.state["status"]).toEqual("error")
      expect(repaired.state["error"]).toEqual(INTERRUPTED_TOOL_ERROR)
      expect((repaired.state["time"] as { start: number }).start).toEqual(1000)
      expect(messages).toHaveLength(1)
    })
  })

  describe("#given an assistant turn holding a pending tool part", () => {
    it("#then settles it and preserves the recorded tool input", async () => {
      // given
      const messages: TestMessage[] = [
        {
          info: { role: "assistant" },
          parts: [createToolPart({ callID: "toolu_pending", status: "pending", input: { command: "ls" } })],
        },
        { info: { role: "user" }, parts: [{ type: "text", text: "continue" }] },
      ]

      // when
      await runToolPairValidator(createToolPairValidatorHook(), messages)

      // then
      const repaired = messages[0]?.parts[0] as { state: Record<string, unknown> }
      expect(repaired.state["status"]).toEqual("error")
      expect(repaired.state["input"]).toEqual({ command: "ls" })
      expect(messages[1]?.parts).toEqual([{ type: "text", text: "continue" }])
    })
  })

  describe("#given a mix of terminal and non-terminal tool parts in one turn", () => {
    it("#then repairs only the non-terminal part", async () => {
      // given
      const messages: TestMessage[] = [
        {
          info: { role: "assistant" },
          parts: [
            createToolPart({ callID: "call_done", status: "completed", output: "done" }),
            createToolPart({ callID: "call_stuck", status: "running" }),
          ],
        },
      ]

      // when
      await runToolPairValidator(createToolPairValidatorHook(), messages)

      // then
      const done = messages[0]?.parts[0] as { state: Record<string, unknown> }
      const stuck = messages[0]?.parts[1] as { state: Record<string, unknown> }
      expect(done.state["status"]).toEqual("completed")
      expect(done.state["output"]).toEqual("done")
      expect(stuck.state["status"]).toEqual("error")
    })
  })

  describe("#given the validator runs twice over the same array", () => {
    it("#then the second pass finds nothing left to repair", async () => {
      // given
      const messages: TestMessage[] = [
        { info: { role: "assistant" }, parts: [createToolPart({ callID: "toolu_1", status: "running" })] },
      ]

      // when
      await runToolPairValidator(createToolPairValidatorHook(), messages)
      const afterFirstPass = structuredClone(messages)
      await runToolPairValidator(createToolPairValidatorHook(), messages)

      // then
      const first = afterFirstPass[0]?.parts[0] as { state: Record<string, unknown> }
      const second = messages[0]?.parts[0] as { state: Record<string, unknown> }
      expect(second.state["status"]).toEqual(first.state["status"])
      expect(second.state["error"]).toEqual(first.state["error"])
    })
  })

  describe("#given a user turn holding no tool parts", () => {
    it("#then the validator never inserts a message", async () => {
      // given
      const messages: TestMessage[] = [
        { info: { role: "user" }, parts: [{ type: "text", text: "hello" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "hi" }] },
      ]
      const before = structuredClone(messages)

      // when
      await runToolPairValidator(createToolPairValidatorHook(), messages)

      // then
      expect(messages).toEqual(before)
    })
  })

  describe("#given a tracked background subagent session", () => {
    it("#then the subagent turn is diagnosed only while a normal session is still repaired", async () => {
      // given
      _resetForTesting()
      subagentSessions.add("ses_background_1")
      const backgroundMessages: TestMessage[] = [
        {
          info: { role: "assistant", sessionID: "ses_background_1" },
          parts: [createToolPart({ callID: "toolu_background", status: "running" })],
        },
      ]
      const originalBackgroundMessages = structuredClone(backgroundMessages)
      const mainMessages: TestMessage[] = [
        {
          info: { role: "assistant", sessionID: "ses_main_1" },
          parts: [createToolPart({ callID: "toolu_main", status: "running" })],
        },
      ]

      try {
        // when
        await runToolPairValidator(createToolPairValidatorHook(), backgroundMessages)
        await runToolPairValidator(createToolPairValidatorHook(), mainMessages)

        // then
        expect(backgroundMessages).toEqual(originalBackgroundMessages)
        const repairedMain = mainMessages[0]?.parts[0] as { state: Record<string, unknown> }
        expect(repairedMain.state["status"]).toEqual("error")
      } finally {
        _resetForTesting()
      }
    })
  })
})
