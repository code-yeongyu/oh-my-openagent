/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { detectCompletionInSessionMessages } from "./completion-promise-detector"
import { createPluginInput } from "./completion-promise-detector-test-input"

describe("detectCompletionInSessionMessages negative cases", () => {
	describe("#given natural language completion text without explicit promise", () => {
		test("#when assistant says work is complete #then should NOT detect completion", async () => {
			// #given
			const messages = [
				{
					info: { role: "assistant" },
					parts: [{ type: "text", text: "The task is complete. All work has been finished." }],
				},
			]
			const ctx = createPluginInput(messages)

			// #when
			const detected = await detectCompletionInSessionMessages(ctx, {
				sessionID: "session-natural-language",
				promise: "DONE",
				apiTimeoutMs: 1000,
				directory: "/tmp",
			})

			// #then
			expect(detected).toBe(false)
		})

		test("#when assistant quotes completion text while still working #then should NOT detect completion", async () => {
			// #given
			const messages = [
				{
					info: { role: "assistant" },
					parts: [{ type: "text", text: 'The user wrote: "the task is complete". I am still working.' }],
				},
			]
			const ctx = createPluginInput(messages)

			// #when
			const detected = await detectCompletionInSessionMessages(ctx, {
				sessionID: "session-quoted-language",
				promise: "DONE",
				apiTimeoutMs: 1000,
				directory: "/tmp",
			})

			// #then
			expect(detected).toBe(false)
		})
	})

	describe("#given promise appears outside assistant text parts", () => {
		test("#when VERIFIED appears only in tool_result part #then should NOT detect completion", async () => {
			// #given
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{ type: "tool_result", text: 'Task completed.\n\nAgent: oracle\n\n<promise>VERIFIED</promise>' },
						{ type: "text", text: "Oracle verified the task." },
					],
				},
			]
			const ctx = createPluginInput(messages)

			// #when
			const detected = await detectCompletionInSessionMessages(ctx, {
				sessionID: "session-verified-tool-result",
				promise: "VERIFIED",
				apiTimeoutMs: 1000,
				directory: "/tmp",
			})

			// #then
			expect(detected).toBe(false)
		})

		test("#when DONE appears only in tool_result part #then should NOT detect completion", async () => {
			// #given
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{ type: "tool_result", text: "Background task output <promise>DONE</promise>" },
						{ type: "text", text: "Task completed successfully." },
					],
				},
			]
			const ctx = createPluginInput(messages)

			// #when
			const detected = await detectCompletionInSessionMessages(ctx, {
				sessionID: "session-done-tool-result",
				promise: "DONE",
				apiTimeoutMs: 1000,
				directory: "/tmp",
			})

			// #then
			expect(detected).toBe(false)
		})
	})
})
