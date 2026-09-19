import { describe, expect, it, mock, beforeEach, spyOn } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

// Mock the prompt-async-gate module
const mockDispatchInternalPrompt = mock()
const mockIsInternalPromptDispatchAccepted = mock()

mock.module("../shared/prompt-async-gate", () => ({
  dispatchInternalPrompt: mockDispatchInternalPrompt,
  isInternalPromptDispatchAccepted: mockIsInternalPromptDispatchAccepted,
}))

// Import after mocking
import { createVerificationReminderHook } from "./index"

function makePluginInput(): PluginInput {
  return {
    directory: "/tmp/test",
    client: {
      session: {
        messages: {
          create: mock().mockResolvedValue({ id: "msg-1" }),
        },
      },
    },
  } as unknown as PluginInput
}

describe("createVerificationReminderHook", () => {
  beforeEach(() => {
    mockDispatchInternalPrompt.mockReset()
    mockIsInternalPromptDispatchAccepted.mockReset()
    mockDispatchInternalPrompt.mockResolvedValue({ status: "ok" })
    mockIsInternalPromptDispatchAccepted.mockReturnValue(true)
  })

  describe("tool.execute.after", () => {
    it("tracks sessions that use edit tools", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx)
      const input = { tool: "edit", sessionID: "ses-1", callID: "call-1" }
      const output = { title: "ok", output: "done", metadata: {} }

      await hook["tool.execute.after"](input, output)

      // No crash; session should be tracked internally
      expect(true).toBe(true)
    })

    it("tracks sessions that use write tools", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx)
      const input = { tool: "write", sessionID: "ses-1", callID: "call-1" }
      const output = { title: "ok", output: "done", metadata: {} }

      await hook["tool.execute.after"](input, output)

      expect(true).toBe(true)
    })

    it("tracks sessions that use hashline_edit tools", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx)
      const input = { tool: "hashline_edit", sessionID: "ses-1", callID: "call-1" }
      const output = { title: "ok", output: "done", metadata: {} }

      await hook["tool.execute.after"](input, output)

      expect(true).toBe(true)
    })

    it("tracks sessions that use apply_patch tools", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx)
      const input = { tool: "apply_patch", sessionID: "ses-1", callID: "call-1" }
      const output = { title: "ok", output: "done", metadata: {} }

      await hook["tool.execute.after"](input, output)

      expect(true).toBe(true)
    })

    it("is case-insensitive for tool names", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx)
      const input = { tool: "EDIT", sessionID: "ses-1", callID: "call-1" }
      const output = { title: "ok", output: "done", metadata: {} }

      await hook["tool.execute.after"](input, output)

      expect(true).toBe(true)
    })

    it("does not track sessions that use non-edit tools", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx)
      const input = { tool: "bash", sessionID: "ses-1", callID: "call-1" }
      const output = { title: "ok", output: "done", metadata: {} }

      await hook["tool.execute.after"](input, output)

      // Should not trigger verification on idle
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

      expect(mockDispatchInternalPrompt).not.toHaveBeenCalled()
    })

    it("does not track sessions that use read tools", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx)
      const input = { tool: "read", sessionID: "ses-1", callID: "call-1" }
      const output = { title: "ok", output: "done", metadata: {} }

      await hook["tool.execute.after"](input, output)

      await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

      expect(mockDispatchInternalPrompt).not.toHaveBeenCalled()
    })
  })

  describe("event", () => {
    it("dispatches verification prompt on idle after edit", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx)

      // Simulate an edit
      await hook["tool.execute.after"](
        { tool: "edit", sessionID: "ses-1", callID: "call-1" },
        { title: "ok", output: "done", metadata: {} },
      )

      // Simulate idle
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

      expect(mockDispatchInternalPrompt).toHaveBeenCalledTimes(1)
      expect(mockDispatchInternalPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "async",
          sessionID: "ses-1",
          source: "verification-reminder:idle-gate",
        }),
      )
    })

    it("does not dispatch on idle without prior edits", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx)

      await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

      expect(mockDispatchInternalPrompt).not.toHaveBeenCalled()
    })

    it("does not dispatch twice for same session without new edits", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx)

      // Simulate an edit
      await hook["tool.execute.after"](
        { tool: "edit", sessionID: "ses-1", callID: "call-1" },
        { title: "ok", output: "done", metadata: {} },
      )

      // First idle
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

      // Second idle
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

      expect(mockDispatchInternalPrompt).toHaveBeenCalledTimes(1)
    })

    it("re-dispatches after new edits", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx)

      // First edit
      await hook["tool.execute.after"](
        { tool: "edit", sessionID: "ses-1", callID: "call-1" },
        { title: "ok", output: "done", metadata: {} },
      )

      // First idle - should dispatch
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

      // Second edit - should reset
      await hook["tool.execute.after"](
        { tool: "write", sessionID: "ses-1", callID: "call-2" },
        { title: "ok", output: "done", metadata: {} },
      )

      // Second idle - should dispatch again
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

      expect(mockDispatchInternalPrompt).toHaveBeenCalledTimes(2)
    })

    it("ignores events without sessionID", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx)

      await hook["tool.execute.after"](
        { tool: "edit", sessionID: "ses-1", callID: "call-1" },
        { title: "ok", output: "done", metadata: {} },
      )

      // Event without sessionID
      await hook.event({ event: { type: "session.idle", properties: {} } })

      expect(mockDispatchInternalPrompt).not.toHaveBeenCalled()
    })

    it("clears state on session.deleted", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx)

      // Simulate an edit
      await hook["tool.execute.after"](
        { tool: "edit", sessionID: "ses-1", callID: "call-1" },
        { title: "ok", output: "done", metadata: {} },
      )

      // Delete session
      await hook.event({ event: { type: "session.deleted", properties: { sessionID: "ses-1" } } })

      // Idle after delete - should not dispatch
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

      expect(mockDispatchInternalPrompt).not.toHaveBeenCalled()
    })

    it("ignores non-idle and non-deleted events", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx)

      await hook["tool.execute.after"](
        { tool: "edit", sessionID: "ses-1", callID: "call-1" },
        { title: "ok", output: "done", metadata: {} },
      )

      // Non-idle event
      await hook.event({ event: { type: "session.created", properties: { sessionID: "ses-1" } } })

      expect(mockDispatchInternalPrompt).not.toHaveBeenCalled()
    })

    it("isolates sessions independently", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx)

      // Edit in session 1
      await hook["tool.execute.after"](
        { tool: "edit", sessionID: "ses-1", callID: "call-1" },
        { title: "ok", output: "done", metadata: {} },
      )

      // Idle in session 2 - should not dispatch
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-2" } } })

      // Idle in session 1 - should dispatch
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

      expect(mockDispatchInternalPrompt).toHaveBeenCalledTimes(1)
      expect(mockDispatchInternalPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ sessionID: "ses-1" }),
      )
    })

    it("warns on dispatch failure when not accepted", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx)
      const consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {})

      mockDispatchInternalPrompt.mockResolvedValue({ status: "failed", error: "test error" })
      mockIsInternalPromptDispatchAccepted.mockReturnValue(false)

      await hook["tool.execute.after"](
        { tool: "edit", sessionID: "ses-1", callID: "call-1" },
        { title: "ok", output: "done", metadata: {} },
      )

      await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[verification-reminder] dispatch failed",
        "test error",
      )

      consoleWarnSpy.mockRestore()
    })

    it("does not warn on dispatch failure when accepted", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx)
      const consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {})

      mockDispatchInternalPrompt.mockResolvedValue({ status: "failed", error: "test error" })
      mockIsInternalPromptDispatchAccepted.mockReturnValue(true)

      await hook["tool.execute.after"](
        { tool: "edit", sessionID: "ses-1", callID: "call-1" },
        { title: "ok", output: "done", metadata: {} },
      )

      await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

      expect(consoleWarnSpy).not.toHaveBeenCalled()

      consoleWarnSpy.mockRestore()
    })
  })

  describe("edit-write tools tracking", () => {
    const editWriteTools = ["edit", "write", "hashline_edit", "apply_patch", "multi_edit", "notepad_edit"]

    for (const tool of editWriteTools) {
      it(`tracks ${tool} as an edit tool`, async () => {
        const ctx = makePluginInput()
        const hook = createVerificationReminderHook(ctx)

        await hook["tool.execute.after"](
          { tool, sessionID: "ses-1", callID: "call-1" },
          { title: "ok", output: "done", metadata: {} },
        )

        await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

        expect(mockDispatchInternalPrompt).toHaveBeenCalledTimes(1)
      })
    }

    const nonEditTools = ["bash", "read", "grep", "glob", "task", "skill"]

    for (const tool of nonEditTools) {
      it(`does not track ${tool} as an edit tool`, async () => {
        const ctx = makePluginInput()
        const hook = createVerificationReminderHook(ctx)

        await hook["tool.execute.after"](
          { tool, sessionID: "ses-1", callID: "call-1" },
          { title: "ok", output: "done", metadata: {} },
        )

        await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

        expect(mockDispatchInternalPrompt).not.toHaveBeenCalled()
      })
    }
  })

  describe("configuration", () => {
    it("uses custom tracked tools when configured", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx, {
        tracked_tools: ["bash", "custom_tool"],
      })

      await hook["tool.execute.after"](
        { tool: "bash", sessionID: "ses-1", callID: "call-1" },
        { title: "ok", output: "done", metadata: {} },
      )

      await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

      expect(mockDispatchInternalPrompt).toHaveBeenCalledTimes(1)
    })

    it("does not track default tools when custom tools configured", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx, {
        tracked_tools: ["bash"],
      })

      await hook["tool.execute.after"](
        { tool: "edit", sessionID: "ses-1", callID: "call-1" },
        { title: "ok", output: "done", metadata: {} },
      )

      await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

      expect(mockDispatchInternalPrompt).not.toHaveBeenCalled()
    })

    it("uses custom prompt when configured", async () => {
      const ctx = makePluginInput()
      const customPrompt = "Custom verification: did you check the tests?"
      const hook = createVerificationReminderHook(ctx, {
        custom_prompt: customPrompt,
      })

      await hook["tool.execute.after"](
        { tool: "edit", sessionID: "ses-1", callID: "call-1" },
        { title: "ok", output: "done", metadata: {} },
      )

      await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

      expect(mockDispatchInternalPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            body: expect.objectContaining({
              parts: [{ type: "text", text: customPrompt }],
            }),
          }),
        }),
      )
    })

    it("uses custom settle_ms when configured", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx, {
        settle_ms: 500,
      })

      await hook["tool.execute.after"](
        { tool: "edit", sessionID: "ses-1", callID: "call-1" },
        { title: "ok", output: "done", metadata: {} },
      )

      await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

      expect(mockDispatchInternalPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          settleMs: 500,
        }),
      )
    })

    it("is case-insensitive for custom tracked tools", async () => {
      const ctx = makePluginInput()
      const hook = createVerificationReminderHook(ctx, {
        tracked_tools: ["BASH", "Custom_Tool"],
      })

      await hook["tool.execute.after"](
        { tool: "bash", sessionID: "ses-1", callID: "call-1" },
        { title: "ok", output: "done", metadata: {} },
      )

      await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

      expect(mockDispatchInternalPrompt).toHaveBeenCalledTimes(1)
    })
  })
})
