/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
import { createRalphLoopHook } from "./index"
import { clearState } from "./storage"

type PromptCall = {
	sessionID: string
	text: string
}

type SessionMessage = {
	info?: {
		role?: string
		agent?: string
		time?: { created?: number }
	}
}

describe("ralph-loop user message race guard", () => {
	const testDirectory = join(tmpdir(), `ralph-loop-user-message-race-${Date.now()}`)
	let promptCalls: PromptCall[]
	let messagesBySession: Record<string, SessionMessage[]>

	beforeEach(() => {
		promptCalls = []
		messagesBySession = {}
		mkdirSync(testDirectory, { recursive: true })
		clearState(testDirectory)
		releaseAllPromptAsyncReservationsForTesting()
	})

	afterEach(() => {
		clearState(testDirectory)
		releaseAllPromptAsyncReservationsForTesting()
		if (existsSync(testDirectory)) {
			rmSync(testDirectory, { recursive: true, force: true })
		}
	})

	function createHook() {
		return createRalphLoopHook({
			directory: testDirectory,
			project: testDirectory,
			worktree: testDirectory,
			serverUrl: "http://localhost:4096",
			$: async () => ({}),
			client: {
				session: {
					messages: async (options: { path: { id: string } }) => ({
						data: messagesBySession[options.path.id] ?? [],
					}),
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
				},
				tui: {
					showToast: async () => ({}),
				},
			},
		} as never, { idleSettleMs: 0 })
	}

	test("#given latest main-session message is a fresh user prompt #when loop idle fires #then continuation is deferred", async () => {
		// given
		const originalDateNow = Date.now
		Date.now = () => 60_000
		const hook = createHook()
		hook.startLoop("session-123", "Keep working", {
			messageCountAtStart: 0,
			maxIterations: 5,
		})
		messagesBySession["session-123"] = [
			{ info: { role: "user", time: { created: Date.now() - 1_000 } } },
		]

		try {
			// when
			await hook.event({
				event: { type: "session.idle", properties: { sessionID: "session-123" } },
			})

			// then
			expect(promptCalls).toHaveLength(0)
			expect(hook.getState()?.iteration).toBe(1)
		} finally {
			Date.now = originalDateNow
		}
	})

	test("#given assistant output is newer than a fresh user prompt #when loop idle fires #then continuation may dispatch", async () => {
		// given
		const originalDateNow = Date.now
		Date.now = () => 60_000
		const hook = createHook()
		hook.startLoop("session-123", "Keep working", {
			messageCountAtStart: 0,
			maxIterations: 5,
		})
		messagesBySession["session-123"] = [
			{ info: { role: "user", time: { created: Date.now() - 1_000 } } },
			{ info: { role: "assistant", agent: "sisyphus", time: { created: Date.now() - 500 } } },
		]

		try {
			// when
			await hook.event({
				event: { type: "session.idle", properties: { sessionID: "session-123" } },
			})

			// then
			expect(promptCalls).toHaveLength(1)
			expect(hook.getState()?.iteration).toBe(2)
		} finally {
			Date.now = originalDateNow
		}
	})
})
