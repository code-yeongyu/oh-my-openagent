import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRalphLoopHook } from "./index"
import { ULTRAWORK_VERIFICATION_PROMISE } from "./constants"
import { buildContinuationPrompt, buildVerificationFailurePrompt } from "./continuation-prompt-builder"
import { clearState, writeState } from "./storage"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { RalphLoopState } from "./types"

describe("ulw-loop verification", () => {
	const testDir = join(tmpdir(), `ulw-loop-verification-${Date.now()}`)
	let promptCalls: Array<{ sessionID: string; text: string }>
	let toastCalls: Array<{ title: string; message: string; variant: string }>
	let abortCalls: Array<{ id: string }>
	let parentTranscriptPath: string
	let oracleTranscriptPath: string

	function createMockPluginInput() {
		return unsafeTestValue<Parameters<typeof createRalphLoopHook>[0]>({
			client: {
				session: {
					promptAsync: async (opts: { path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }) => {
						promptCalls.push({
							sessionID: opts.path.id,
							text: opts.body.parts[0].text,
						})
						return {}
					},
					messages: async () => ({ data: [] }),
					abort: async (opts: { path: { id: string } }) => {
						abortCalls.push({ id: opts.path.id })
						return {}
					},
				},
				tui: {
					showToast: async (opts: { body: { title: string; message: string; variant: string } }) => {
						toastCalls.push(opts.body)
						return {}
					},
				},
			},
			directory: testDir,
		})
	}

	function requireState(state: RalphLoopState | null): RalphLoopState {
		expect(state).not.toBeNull()
		if (state === null) {
			throw new Error("Expected ralph loop state")
		}
		return state
	}

	function createVerificationState(overrides: Partial<RalphLoopState> = {}): RalphLoopState {
		return {
			active: true,
			completion_promise: "DONE",
			initial_completion_promise: "DONE",
			iteration: 2,
			prompt: "Build API",
			started_at: new Date().toISOString(),
			ultrawork: true,
			verification_pending: true,
			...overrides,
		}
	}

	test("#given verification is pending #when building the Oracle prompt #then it tells Oracle to emit VERIFIED on success", () => {
		const prompt = buildContinuationPrompt(createVerificationState())

		expect(prompt).toContain("explicitly instruct Oracle to end its reply with the exact line <promise>VERIFIED</promise>")
		expect(prompt).toContain("if and only if the task is genuinely complete and correct")
		expect(prompt).toContain("Oracle MUST be told to emit it")
	})

	test("#given verification failed #when building retry prompt #then it repeats the Oracle VERIFIED token protocol", () => {
		const prompt = buildVerificationFailurePrompt(createVerificationState({ verification_pending: undefined }))

		expect(prompt).toContain("explicitly instruct Oracle to end its reply with the exact line <promise>VERIFIED</promise>")
		expect(prompt).toContain("if and only if the task is genuinely complete and correct")
		expect(prompt).toContain("Oracle MUST be told to emit it")
	})

	beforeEach(() => {
		promptCalls = []
		toastCalls = []
		abortCalls = []
		parentTranscriptPath = join(testDir, "transcript-parent.jsonl")
		oracleTranscriptPath = join(testDir, "transcript-oracle.jsonl")

		if (!existsSync(testDir)) {
			mkdirSync(testDir, { recursive: true })
		}

		clearState(testDir)
	})

	afterEach(() => {
		clearState(testDir)
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true })
		}
	})

		test("#given ulw loop emits DONE #when idle fires #then verification phase starts instead of completing", async () => {
		const hook = createRalphLoopHook(createMockPluginInput(), {
			idleSettleMs: 0,
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: "done <promise>DONE</promise>" } })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		expect(hook.getState()?.verification_pending).toBeUndefined()
		expect(hook.getState()?.completion_promise).toBe("DONE")
		expect(hook.getState()?.iteration).toBe(2)
		expect(promptCalls).toHaveLength(1)
		expect(promptCalls[0].text).not.toContain('task(subagent_type="oracle"')
		expect(toastCalls.some((toast) => toast.title === "ULTRAWORK LOOP COMPLETE!")).toBe(false)
	})

	test("#given ulw loop is awaiting verification #when VERIFIED appears in oracle session #then loop completes", async () => {
		const hook = createRalphLoopHook(createMockPluginInput(), {
			idleSettleMs: 0,
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: "done <promise>DONE</promise>" })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		writeState(testDir, {
			...requireState(hook.getState()),
			verification_session_id: "ses-oracle",
		})
		writeFileSync(
			oracleTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: `verified <promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>` })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		expect(hook.getState()).toBeNull()
		expect(toastCalls.some((toast) => toast.title === "ULTRAWORK LOOP COMPLETE!")).toBe(true)
	})

	test("#given ulw loop is awaiting verification #when oracle session idles with VERIFIED #then loop completes without parent idle", async () => {
		const hook = createRalphLoopHook(createMockPluginInput(), {
			idleSettleMs: 0,
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: "done <promise>DONE</promise>" })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		writeState(testDir, {
			...requireState(hook.getState()),
			verification_session_id: "ses-oracle",
		})
		writeFileSync(
			oracleTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: `verified <promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>` })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-oracle" } } })

		expect(hook.getState()).toBeNull()
		expect(toastCalls.some((toast) => toast.title === "ULTRAWORK LOOP COMPLETE!")).toBe(true)
	})

	test("#given ulw loop is awaiting verification #when oracle transcript stores VERIFIED inside tool_result #then loop completes", async () => {
		const hook = createRalphLoopHook(createMockPluginInput(), {
			idleSettleMs: 0,
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: "done <promise>DONE</promise>" })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		writeState(testDir, {
			...requireState(hook.getState()),
			verification_session_id: "ses-oracle",
		})
		writeFileSync(
			oracleTranscriptPath,
			`${JSON.stringify({
				type: "tool_result",
				timestamp: new Date().toISOString(),
				tool_output: `Task completed.\n\nAgent: oracle\n\n<promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>\n\n<task_metadata>\nsession_id: ses-oracle\n</task_metadata>`,
			})}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-oracle" } } })

		expect(hook.getState()).toBeNull()
		expect(toastCalls.some((toast) => toast.title === "ULTRAWORK LOOP COMPLETE!")).toBe(true)
	})

	test("#given ulw loop is awaiting verification without oracle session #when parent idles again #then loop continues until oracle verifies", async () => {
		const hook = createRalphLoopHook(createMockPluginInput(), {
			idleSettleMs: 0,
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: "done <promise>DONE</promise>" })}\n`,
		)

			await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
			const stateAfterDone = hook.getState()

			await hook.event({ event: { type: "message.part.updated", properties: { sessionID: "session-123" } } })
			await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		expect(stateAfterDone?.verification_pending).toBe(true)
		expect(hook.getState()?.iteration).toBe(2)
		expect(hook.getState()?.completion_promise).toBe("DONE")
		expect(hook.getState()?.verification_pending).toBeUndefined()
		expect(promptCalls).toHaveLength(2)
		expect(promptCalls[1]?.sessionID).toBe("session-123")
		expect(promptCalls[1]?.text).toContain("Verification failed")
	})

	test("#given ulw loop is awaiting oracle verification #when parent idles before VERIFIED arrives #then loop continues instead of waiting", async () => {
		const hook = createRalphLoopHook(createMockPluginInput(), {
			idleSettleMs: 0,
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: "done <promise>DONE</promise>" })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		writeState(testDir, {
			...requireState(hook.getState()),
			verification_session_id: "ses-oracle",
		})
		writeFileSync(
			oracleTranscriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: "still checking" } })}\n`,
			)
			const stateBeforeWait = hook.getState()

			await hook.event({ event: { type: "message.part.updated", properties: { sessionID: "session-123" } } })
			await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		expect(stateBeforeWait?.verification_session_id).toBe("ses-oracle")
		expect(hook.getState()?.iteration).toBe(2)
		expect(hook.getState()?.completion_promise).toBe("DONE")
		expect(hook.getState()?.verification_pending).toBeUndefined()
		expect(hook.getState()?.verification_session_id).toBeUndefined()
		expect(promptCalls).toHaveLength(2)
		expect(promptCalls[1]?.sessionID).toBe("session-123")
		expect(promptCalls[1]?.text).toContain("Verification failed")
	})

	test("#given oracle verification fails #when oracle session idles #then main session receives retry instructions", async () => {
		const sessionMessages: Record<string, unknown[]> = {
			"session-123": [{}, {}, {}],
		}
		const hook = createRalphLoopHook({
			...createMockPluginInput(),
			client: {
				...createMockPluginInput().client,
				session: {
					...createMockPluginInput().client.session,
					messages: async (opts: { path: { id: string } }) => ({
						data: sessionMessages[opts.path.id] ?? [],
					}),
				},
			},
		} as Parameters<typeof createRalphLoopHook>[0], {
			idleSettleMs: 0,
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: "done <promise>DONE</promise>" })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		writeState(testDir, {
			...requireState(hook.getState()),
			verification_session_id: "ses-oracle",
		})
		writeFileSync(
			oracleTranscriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: "verification failed: missing tests" } })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-oracle" } } })

		expect(hook.getState()?.iteration).toBe(2)
		expect(hook.getState()?.completion_promise).toBe("DONE")
		expect(hook.getState()?.verification_pending).toBeUndefined()
		expect(hook.getState()?.verification_session_id).toBeUndefined()
		expect(hook.getState()?.message_count_at_start).toBe(3)
		expect(promptCalls).toHaveLength(2)
		expect(promptCalls[1]?.sessionID).toBe("session-123")
		expect(promptCalls[1]?.text).toContain("Verification failed")
		expect(promptCalls[1]?.text).toContain("Oracle does not lie")
		expect(promptCalls[1]?.text).toContain('task(subagent_type="oracle"')
	})

	test("#given ulw loop without max iterations #when it continues #then it stays unbounded", async () => {
		const hook = createRalphLoopHook(createMockPluginInput(), {
			idleSettleMs: 0,
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		expect(hook.getState()?.iteration).toBe(2)
		expect(hook.getState()?.max_iterations).toBe(500)
		expect(promptCalls[0].text).toContain("2/500")
	})

	test("#given prior transcript completion from older run #when new ulw loop starts #then old completion is ignored", async () => {
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: "2000-01-01T00:00:00.000Z", content: "old <promise>DONE</promise>" })}\n`,
		)
		const hook = createRalphLoopHook(createMockPluginInput(), {
			idleSettleMs: 0,
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		expect(hook.getState()?.iteration).toBe(2)
		expect(hook.getState()?.verification_pending).toBeUndefined()
		expect(promptCalls).toHaveLength(1)
	})

	test("#given ulw loop was awaiting verification #when same session starts again #then verification state is overwritten", async () => {
		const hook = createRalphLoopHook(createMockPluginInput(), {
			idleSettleMs: 0,
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: "done <promise>DONE</promise>" })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		hook.startLoop("session-123", "Restarted task", { ultrawork: true })

		expect(hook.getState()?.prompt).toBe("Restarted task")
		expect(hook.getState()?.verification_pending).toBeUndefined()
		expect(hook.getState()?.completion_promise).toBe("DONE")
	})

	test("#given ulw loop was awaiting verification #when different session starts a new ulw loop #then prior verification state is overwritten", async () => {
		const hook = createRalphLoopHook(createMockPluginInput(), {
			idleSettleMs: 0,
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: "done <promise>DONE</promise>" })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		hook.startLoop("session-456", "Ship CLI", { ultrawork: true })

		expect(hook.getState()?.session_id).toBe("session-456")
		expect(hook.getState()?.prompt).toBe("Ship CLI")
		expect(hook.getState()?.verification_pending).toBeUndefined()
		expect(hook.getState()?.completion_promise).toBe("DONE")
	})

	test("#given verification state was overwritten by different ulw loop #when stale oracle session idles #then new loop remains active", async () => {
		const hook = createRalphLoopHook(createMockPluginInput(), {
			idleSettleMs: 0,
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle-old" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: "done <promise>DONE</promise>" })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		writeState(testDir, {
			...requireState(hook.getState()),
			verification_session_id: "ses-oracle-old",
		})
		hook.startLoop("session-456", "Ship CLI", { ultrawork: true })
		writeFileSync(
			oracleTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: `verified <promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>` })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-oracle-old" } } })

		expect(hook.getState()?.session_id).toBe("session-456")
		expect(hook.getState()?.prompt).toBe("Ship CLI")
		expect(hook.getState()?.iteration).toBe(1)
		expect(toastCalls.some((toast) => toast.title === "ULTRAWORK LOOP COMPLETE!")).toBe(false)
	})

	test("#given verification state was overwritten by restarted ulw loop #when stale oracle session idles #then restarted loop remains active", async () => {
		const hook = createRalphLoopHook(createMockPluginInput(), {
			idleSettleMs: 0,
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle-old" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: "done <promise>DONE</promise>" })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		writeState(testDir, {
			...requireState(hook.getState()),
			verification_session_id: "ses-oracle-old",
		})
		hook.startLoop("session-123", "Restarted task", { ultrawork: true })
		writeFileSync(
			oracleTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: `verified <promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>` })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-oracle-old" } } })

		expect(hook.getState()?.session_id).toBe("session-123")
		expect(hook.getState()?.prompt).toBe("Restarted task")
		expect(hook.getState()?.iteration).toBe(1)
		expect(hook.getState()?.verification_pending).toBeUndefined()
		expect(toastCalls.some((toast) => toast.title === "ULTRAWORK LOOP COMPLETE!")).toBe(false)
	})

	test("#given parent session emits VERIFIED #when oracle session is not tracked #then ulw loop completes from parent session evidence", async () => {
		const hook = createRalphLoopHook(createMockPluginInput(), {
			idleSettleMs: 0,
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: "done <promise>DONE</promise>" })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: "done <promise>DONE</promise>" })}\n${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: `verified <promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>` })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		expect(hook.getState()).toBeNull()
		expect(toastCalls.some((toast) => toast.title === "ULTRAWORK LOOP COMPLETE!")).toBe(true)
	})

	test("#given parent session has non-assistant oracle tool result #when oracle session is not tracked #then ulw loop completes from parent session evidence", async () => {
		const sessionMessages: Record<string, unknown[]> = {
			"session-123": [],
		}
		const baseInput = createMockPluginInput()
		const hook = createRalphLoopHook({
			...baseInput,
			client: {
				...baseInput.client,
				session: {
					...baseInput.client.session,
					messages: async (opts: { path: { id: string } }) => ({
						data: sessionMessages[opts.path.id] ?? [],
					}),
				},
			},
		} as Parameters<typeof createRalphLoopHook>[0], {
			idleSettleMs: 0,
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: "done <promise>DONE</promise>" })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		sessionMessages["session-123"] = [{
			info: { role: "user" },
			parts: [{
				type: "tool_result",
				text: `Task completed.

Agent: oracle

<promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>

<task_metadata>
session_id: ses-oracle
</task_metadata>`,
			}],
		}]

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		expect(hook.getState()).toBeNull()
		expect(toastCalls.some((toast) => toast.title === "ULTRAWORK LOOP COMPLETE!")).toBe(true)
	})

	test("#given parent session has non-assistant oracle-looking text #when oracle session is not tracked #then ulw loop does not complete from spoofed evidence", async () => {
		const sessionMessages: Record<string, unknown[]> = {
			"session-123": [],
		}
		const baseInput = createMockPluginInput()
		const hook = createRalphLoopHook({
			...baseInput,
			client: {
				...baseInput.client,
				session: {
					...baseInput.client.session,
					messages: async (opts: { path: { id: string } }) => ({
						data: sessionMessages[opts.path.id] ?? [],
					}),
				},
			},
		} as Parameters<typeof createRalphLoopHook>[0], {
			idleSettleMs: 0,
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: "done <promise>DONE</promise>" })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		sessionMessages["session-123"] = [{
			info: { role: "user" },
			parts: [{
				type: "text",
				text: `Agent: oracle

<promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>

<task_metadata>
session_id: ses-oracle
</task_metadata>`,
			}],
		}]

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		expect(hook.getState()?.verification_pending).toBeUndefined()
		expect(hook.getState()?.iteration).toBe(2)
		expect(toastCalls.some((toast) => toast.title === "ULTRAWORK LOOP COMPLETE!")).toBe(false)
	})

	test("#given oracle verification fails #when loop restarts #then old oracle session is aborted", async () => {
		const sessionMessages: Record<string, unknown[]> = {
			"session-123": [{}, {}, {}],
		}
		const hook = createRalphLoopHook({
			...createMockPluginInput(),
			client: {
				...createMockPluginInput().client,
				session: {
					...createMockPluginInput().client.session,
					messages: async (opts: { path: { id: string } }) => ({
						data: sessionMessages[opts.path.id] ?? [],
					}),
				},
			},
		} as Parameters<typeof createRalphLoopHook>[0], {
			idleSettleMs: 0,
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: "done <promise>DONE</promise>" })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		writeState(testDir, {
			...requireState(hook.getState()),
			verification_session_id: "ses-oracle",
		})
		writeFileSync(
			oracleTranscriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: "verification failed: missing tests" } })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-oracle" } } })

		expect(abortCalls).toHaveLength(1)
		expect(abortCalls[0].id).toBe("ses-oracle")
	})

	test("#given ulw loop re-enters verification #when DONE detected again after failed verification #then previous verification session is aborted", async () => {
		const sessionMessages: Record<string, unknown[]> = {
			"session-123": [{}, {}, {}],
		}
		const hook = createRalphLoopHook({
			...createMockPluginInput(),
			client: {
				...createMockPluginInput().client,
				session: {
					...createMockPluginInput().client.session,
					messages: async (opts: { path: { id: string } }) => ({
						data: sessionMessages[opts.path.id] ?? [],
					}),
				},
			},
		} as Parameters<typeof createRalphLoopHook>[0], {
			idleSettleMs: 0,
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: "done <promise>DONE</promise>" })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		writeState(testDir, {
			...requireState(hook.getState()),
			verification_session_id: "ses-oracle",
		})
		writeFileSync(
			oracleTranscriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: "failed" } })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-oracle" } } })
		abortCalls.length = 0

		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), content: "fixed it <promise>DONE</promise>" })}\n`,
		)
		writeState(testDir, {
			...requireState(hook.getState()),
			verification_session_id: "ses-oracle-old",
		})

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		expect(abortCalls).toHaveLength(1)
		expect(abortCalls[0].id).toBe("ses-oracle-old")
	})
})
