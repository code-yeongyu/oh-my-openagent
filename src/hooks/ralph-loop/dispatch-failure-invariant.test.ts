/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRalphLoopHook } from "./index"
import { ULTRAWORK_VERIFICATION_PROMISE } from "./constants"
import { clearState, writeState } from "./storage"

describe("ralph-loop dispatch failure invariants", () => {
	const testDirectory = join(tmpdir(), `ralph-loop-dispatch-failure-${Date.now()}`)
	let promptCalls: Array<{ sessionID: string; text: string }>
	let toastCalls: Array<{ title: string; message: string; variant: string }>
	let messagesCalls: Array<{ sessionID: string }>
	let createSessionCalls: Array<{ parentID: string }>

	beforeEach(() => {
		promptCalls = []
		toastCalls = []
		messagesCalls = []
		createSessionCalls = []
		mkdirSync(testDirectory, { recursive: true })
		clearState(testDirectory)
	})

	afterEach(() => {
		clearState(testDirectory)
		if (existsSync(testDirectory)) {
			rmSync(testDirectory, { recursive: true, force: true })
		}
	})

	test("#given idle path #when promptAsync throws #then no state or toast advance", async () => {
		// given
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
					promptAsync: async () => {
						throw new Error("simulated dispatch failure")
					},
					prompt: async () => ({}),
					create: async () => ({ data: { id: "new-session-id" } }),
				},
				tui: {
					showToast: async (options: { body: { title: string; message: string; variant: string } }) => {
						toastCalls.push(options.body)
						return {}
					},
				},
			},
		} as never)

		hook.startLoop("session-123", "Keep working", {
			messageCountAtStart: 0,
			maxIterations: 5,
		})
		expect(hook.getState()?.iteration).toBe(1)

		// when
		await hook.event({
			event: { type: "session.idle", properties: { sessionID: "session-123" } },
		})

		// then
		expect(toastCalls.some((toast) => toast.title === "Ralph Loop" && toast.message.includes("Iteration"))).toBe(false)
		expect(hook.getState()).toBeNull()
		expect(toastCalls.some((toast) => toast.title === "Ralph Loop Failed" && toast.message.includes("dispatch_rejected"))).toBe(true)
	})

	test("#given error retry path #when promptAsync throws #then no state or toast advance", async () => {
		// given
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
					promptAsync: async () => {
						throw new Error("simulated dispatch failure")
					},
					prompt: async () => ({}),
					create: async () => ({ data: { id: "new-session-id" } }),
				},
				tui: {
					showToast: async (options: { body: { title: string; message: string; variant: string } }) => {
						toastCalls.push(options.body)
						return {}
					},
				},
			},
		} as never)

		hook.startLoop("session-123", "Keep working", {
			messageCountAtStart: 0,
			maxIterations: 5,
		})
		expect(hook.getState()?.iteration).toBe(1)

		// when
		await hook.event({
			event: {
				type: "session.error",
				properties: {
					sessionID: "session-123",
					error: { name: "RuntimeError" },
				},
			},
		})

		// then
		expect(toastCalls.some((toast) => toast.title === "Ralph Loop" && toast.message.includes("Iteration"))).toBe(false)
		expect(hook.getState()).toBeNull()
		expect(toastCalls.some((toast) => toast.title === "Ralph Loop Failed" && toast.message.includes("dispatch_rejected"))).toBe(true)
	})

	test("#given verification-failure path #when promptAsync throws #then iteration not advanced", async () => {
		// given
		const parentTranscriptPath = join(testDirectory, "transcript-parent.jsonl")
		const oracleTranscriptPath = join(testDirectory, "transcript-oracle.jsonl")
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
						if (options.path.id === "session-123") {
							return { data: [{}, {}, {}] }
						}
						return { data: [] }
					},
					promptAsync: async (options: { body: { parts: Array<{ type: string; text: string }> } }) => {
						if (options.body.parts[0]?.text.includes("Verification failed")) {
							throw new Error("simulated dispatch failure")
						}
						return {}
					},
					prompt: async () => ({}),
					abort: async () => ({}),
					create: async () => ({ data: { id: "new-session-id" } }),
				},
				tui: {
					showToast: async (options: { body: { title: string; message: string; variant: string } }) => {
						toastCalls.push(options.body)
						return {}
					},
				},
			},
		} as never, {
			getTranscriptPath: (sessionID): string => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})

		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeState(testDirectory, {
			...hook.getState()!,
			iteration: 2,
			verification_pending: true,
			verification_session_id: "ses-oracle",
			completion_promise: ULTRAWORK_VERIFICATION_PROMISE,
			initial_completion_promise: "DONE",
		})
		writeState(testDirectory, {
			...hook.getState()!,
			verification_session_id: "ses-oracle",
		})
		writeFileSync(
			oracleTranscriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: "verification failed" } })}\n`,
		)

		const preRestartIteration = hook.getState()?.iteration

		// when
		await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-oracle" } } })

		// then
		expect(preRestartIteration).toBe(2)
		expect(hook.getState()).toBeNull()
		expect(toastCalls.some((toast) => toast.title === "Ralph Loop Failed" && toast.message.includes("Verification continuation rejected"))).toBe(true)
	})

	test("#given reset strategy #when createIterationSession returns null #then dispatch failure surfaces", async () => {
		// given
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
					promptAsync: async (options: { path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }) => {
						promptCalls.push({
							sessionID: options.path.id,
							text: options.body.parts[0]?.text ?? "",
						})
						return {}
					},
					prompt: async () => ({}),
					create: async (options: { body: { parentID: string } }) => {
						createSessionCalls.push({ parentID: options.body.parentID })
						return { error: "fail", data: undefined }
					},
				},
				tui: {
					showToast: async (options: { body: { title: string; message: string; variant: string } }) => {
						toastCalls.push(options.body)
						return {}
					},
				},
			},
		} as never)

		hook.startLoop("session-123", "Keep working", {
			messageCountAtStart: 0,
			maxIterations: 5,
			strategy: "reset",
		})
		expect(hook.getState()?.iteration).toBe(1)

		// when
		await hook.event({
			event: { type: "session.idle", properties: { sessionID: "session-123" } },
		})

		// then
		expect(hook.getState()).toBeNull()
		expect(promptCalls).toHaveLength(0)
		expect(createSessionCalls).toHaveLength(1)
		expect(toastCalls.some((toast) => toast.title === "Ralph Loop Failed" && toast.message.includes("session_creation_rejected"))).toBe(true)
	})
})
