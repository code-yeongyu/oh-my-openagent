/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRalphLoopHook } from "./index"
import { clearState } from "./storage"

describe("ralph-loop non-abort error continuation", () => {
	const testDirectory = join(tmpdir(), `ralph-loop-non-abort-error-${Date.now()}`)
	let promptCalls: Array<{ sessionID: string; text: string }>
	let messagesCalls: Array<{ sessionID: string }>

	beforeEach(() => {
		promptCalls = []
		messagesCalls = []
		mkdirSync(testDirectory, { recursive: true })
		clearState(testDirectory)
	})

	afterEach(() => {
		clearState(testDirectory)
		if (existsSync(testDirectory)) {
			rmSync(testDirectory, { recursive: true, force: true })
		}
	})

	test("continues on next idle after non-abort session error", async () => {
		// given - an active Ralph Loop receives a recoverable command error
		const hook = createRalphLoopHook({
			directory: testDirectory,
			project: testDirectory,
			worktree: testDirectory,
			serverUrl: "http://localhost:4096",
			$: async () => ({}),
			client: {
				session: {
					messages: async (options: { path: { id: string } }) => {
						messagesCalls.push({ sessionID: options.path.id })
						return { data: [] }
					},
					promptAsync: async (options: {
						path: { id: string }
						body: { parts: Array<{ type: string; text: string }> }
					}) => {
						promptCalls.push({
							sessionID: options.path.id,
							text: options.body.parts[0]?.text ?? "",
						})
						return {}
					},
					prompt: async (options: {
						path: { id: string }
						body: { parts: Array<{ type: string; text: string }> }
					}) => {
						promptCalls.push({
							sessionID: options.path.id,
							text: options.body.parts[0]?.text ?? "",
						})
						return {}
					},
				},
				tui: {
					showToast: async () => ({}),
				},
			},
		} as never)

		hook.startLoop("session-123", "Keep working", {
			messageCountAtStart: 0,
			maxIterations: 5,
		})

		await hook.event({
			event: {
				type: "session.error",
				properties: {
					sessionID: "session-123",
					error: { name: "CommandFailedError" },
				},
			},
		})

		// when - OpenCode emits the idle event caused by that failed command
		await hook.event({
			event: { type: "session.idle", properties: { sessionID: "session-123" } },
		})

		// then - the loop should continue instead of skipping idle as recovery
		expect(promptCalls).toHaveLength(1)
		expect(promptCalls[0]?.sessionID).toBe("session-123")
		expect(promptCalls[0]?.text).toContain("Keep working")
		expect(messagesCalls.length).toBeGreaterThan(0)
		expect(hook.getState()?.iteration).toBe(2)
	})
})
