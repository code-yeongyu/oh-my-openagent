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

type ToastCall = {
	readonly title: string
	readonly message: string
	readonly variant: string
}

describe("ralph-loop no-progress stop", () => {
	const testDirectory = join(tmpdir(), "ralph-loop-no-progress-" + Date.now())
	let promptCalls: PromptCall[]
	let toastCalls: ToastCall[]

	beforeEach(() => {
		promptCalls = []
		toastCalls = []
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

	test("#given latest assistant made no model progress #when session goes idle #then ralph loop stops without injecting another continuation", async () => {
		const hook = createRalphLoopHook(unsafeTestValue({
			client: {
				session: {
					promptAsync: async (opts: { readonly path: { readonly id: string }; readonly body: { readonly parts: readonly [{ readonly text: string }] } }) => {
						promptCalls.push({
							sessionID: opts.path.id,
							text: opts.body.parts[0].text,
						})
						return {}
					},
					messages: async () => ({
						data: [
							{ info: { role: "user" }, parts: [{ type: "text", text: "Continue" }] },
							{
								info: {
									role: "assistant",
									finish: "unknown",
									tokens: {
										input: 0,
										output: 0,
										reasoning: 0,
										cache: { write: 0, read: 0 },
									},
								},
								parts: [
									{ type: "step-start" },
									{ type: "step-finish" },
								],
							},
						],
					}),
				},
				tui: {
					showToast: async (opts: { readonly body: ToastCall }) => {
						toastCalls.push(opts.body)
						return {}
					},
				},
			},
			directory: testDirectory,
		}))
		hook.startLoop("session-123", "Build API", { ultrawork: true })

		await hook.event({
			event: { type: "session.idle", properties: { sessionID: "session-123" } },
		})

		expect(promptCalls).toHaveLength(0)
		expect(hook.getState()).toBeNull()
		expect(toastCalls.some((toast) => toast.title === "Ralph Loop Stopped")).toBe(true)
	})
})
