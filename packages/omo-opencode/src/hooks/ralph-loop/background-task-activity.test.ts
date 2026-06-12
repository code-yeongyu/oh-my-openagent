/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createRalphLoopHook } from "./index"
import { clearState } from "./storage"

type PromptCall = {
	readonly sessionID: string
	readonly text: string
}

type BackgroundTaskStatus = "pending" | "running"

describe("ralph-loop background task activity", () => {
	const testDirectory = join(tmpdir(), `ralph-loop-bg-activity-${Date.now()}`)
	let promptCalls: PromptCall[]
	let taskStatus: BackgroundTaskStatus

	function createMockPluginInput() {
		return unsafeTestValue<Parameters<typeof createRalphLoopHook>[0]>({
			client: {
				session: {
					promptAsync: async (opts: { readonly path: { readonly id: string }; readonly body: { readonly parts: readonly [{ readonly text: string }] } }) => {
						promptCalls.push({
							sessionID: opts.path.id,
							text: opts.body.parts[0].text,
						})
						return {}
					},
					messages: async () => ({ data: [] }),
				},
			},
			directory: testDirectory,
		})
	}

	function createHookWithBackgroundTask() {
		return createRalphLoopHook(createMockPluginInput(), {
			idleSettleMs: 0,
			backgroundManager: {
				getTasksByParentSession: () => [{ status: taskStatus }],
			},
		})
	}

	beforeEach(() => {
		promptCalls = []
		taskStatus = "pending"
		if (!existsSync(testDirectory)) {
			mkdirSync(testDirectory, { recursive: true })
		}
		clearState(testDirectory)
	})

	afterEach(() => {
		clearState(testDirectory)
		if (existsSync(testDirectory)) {
			rmSync(testDirectory, { recursive: true, force: true })
		}
	})

	test("#given a ralph loop has a pending background task #when the parent session idles #then continuation waits for the task", async () => {
		// given
		const hook = createHookWithBackgroundTask()
		hook.startLoop("session-123", "Wait for the subagent")

		// when
		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		// then
		expect(promptCalls).toHaveLength(0)
		expect(hook.getState()?.iteration).toBe(1)
	})

	test("#given a ralph loop has a pending background task #when the parent session errors #then runtime retry waits for the task", async () => {
		// given
		const hook = createHookWithBackgroundTask()
		hook.startLoop("session-123", "Wait for the subagent")

		// when
		await hook.event({
			event: {
				type: "session.error",
				properties: { sessionID: "session-123", error: new Error("runtime") },
			},
		})

		// then
		expect(promptCalls).toHaveLength(0)
		expect(hook.getState()?.iteration).toBe(1)
	})
})
