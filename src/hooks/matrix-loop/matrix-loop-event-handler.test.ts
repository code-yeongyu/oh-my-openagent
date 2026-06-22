/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createMatrixLoopHook } from "./matrix-loop-hook"
import { clearState } from "./storage"

describe("matrix-loop event handler", () => {
	const TEST_DIR = join(tmpdir(), `matrix-loop-event-handler-test-${Date.now()}`)
	let messagesCalls: Array<{ sessionID: string }>
	let mockSessionMessages: Array<{ info?: { role?: string }; parts?: Array<{ type: string; text?: string }> }>

	function createMockPluginInput() {
		messagesCalls = []
		return {
			client: {
				session: {
					prompt: async () => {
						return {}
					},
					promptAsync: async () => {
						return {}
					},
					messages: async (opts: { path: { id: string } }) => {
						messagesCalls.push({ sessionID: opts.path.id })
						return { data: mockSessionMessages }
					},
					create: async () => ({ data: { id: "verify-session-1" } }),
					delete: async () => ({}),
				},
				tui: {
					showToast: async () => ({}),
				},
			},
			directory: TEST_DIR,
		} as unknown as Parameters<typeof createMatrixLoopHook>[0]
	}

	beforeEach(() => {
		mockSessionMessages = []
		if (!existsSync(TEST_DIR)) {
			mkdirSync(TEST_DIR, { recursive: true })
		}
		clearState(TEST_DIR)
	})

	afterEach(() => {
		clearState(TEST_DIR)
		if (existsSync(TEST_DIR)) {
			rmSync(TEST_DIR, { recursive: true, force: true })
		}
	})

	//#given session.idle fires with a loop that has completion promise in messages
	//#and verification is enabled (triggers both detection AND verification paths)
	//#when event handler runs
	//#then session.messages is called exactly once (cached between detector and verifier)
	test("session.idle event calls session.messages at most once per handler", async () => {
		// given - mock with completion promise in assistant message (triggers detection)
		mockSessionMessages = [
			{ info: { role: "assistant" }, parts: [{ type: "text", text: "<promise>DONE</promise>" }] },
		]
		const hook = createMatrixLoopHook(createMockPluginInput(), {
			getTranscriptPath: () => join(TEST_DIR, "nonexistent.jsonl"),
			verification: { enabled: true, timeoutMs: 1000 },
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })

		// when - session.idle event triggers both detection AND verification
		await hook.event({
			event: { type: "session.idle", properties: { sessionID: "session-123" } },
		})

		// then - session.messages called exactly ONCE (H4: shared between detector + verifier)
		expect(messagesCalls.length).toBe(1)
		expect(messagesCalls[0].sessionID).toBe("session-123")
	})
})
