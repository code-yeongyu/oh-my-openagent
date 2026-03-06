import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRalphLoopHook } from "./index"
import { ULTRAWORK_VERIFICATION_PROMISE } from "./constants"
import { clearState, writeState } from "./storage"

describe("ulw-loop verification", () => {
	const testDir = join(tmpdir(), `ulw-loop-verification-${Date.now()}`)
	let promptCalls: Array<{ sessionID: string; text: string }>
	let toastCalls: Array<{ title: string; message: string; variant: string }>
	let parentTranscriptPath: string
	let oracleTranscriptPath: string

	function createMockPluginInput() {
		return {
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
				},
				tui: {
					showToast: async (opts: { body: { title: string; message: string; variant: string } }) => {
						toastCalls.push(opts.body)
						return {}
					},
				},
			},
			directory: testDir,
		} as unknown as Parameters<typeof createRalphLoopHook>[0]
	}

	beforeEach(() => {
		promptCalls = []
		toastCalls = []
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
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: "done <promise>DONE</promise>" } })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		expect(hook.getState()?.verification_pending).toBe(true)
		expect(hook.getState()?.completion_promise).toBe(ULTRAWORK_VERIFICATION_PROMISE)
		expect(hook.getState()?.verification_session_id).toBeUndefined()
		expect(promptCalls).toHaveLength(1)
		expect(promptCalls[0].text).toContain('task(subagent_type="oracle"')
		expect(toastCalls.some((toast) => toast.title === "ULTRAWORK LOOP COMPLETE!")).toBe(false)
	})

	test("#given ulw loop is awaiting verification #when VERIFIED appears in oracle session #then loop completes", async () => {
		const hook = createRalphLoopHook(createMockPluginInput(), {
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: "done <promise>DONE</promise>" } })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		writeState(testDir, {
			...hook.getState()!,
			verification_session_id: "ses-oracle",
		})
		writeFileSync(
			oracleTranscriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: `verified <promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>` } })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		expect(hook.getState()).toBeNull()
		expect(toastCalls.some((toast) => toast.title === "ULTRAWORK LOOP COMPLETE!")).toBe(true)
	})

	test("#given ulw loop is awaiting verification #when oracle session idles with VERIFIED #then loop completes without parent idle", async () => {
		const hook = createRalphLoopHook(createMockPluginInput(), {
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: "done <promise>DONE</promise>" } })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		writeState(testDir, {
			...hook.getState()!,
			verification_session_id: "ses-oracle",
		})
		writeFileSync(
			oracleTranscriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: `verified <promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>` } })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-oracle" } } })

		expect(hook.getState()).toBeNull()
		expect(toastCalls.some((toast) => toast.title === "ULTRAWORK LOOP COMPLETE!")).toBe(true)
	})

	test("#given ulw loop is awaiting verification without oracle session #when idle fires again #then loop waits instead of continuing", async () => {
		const hook = createRalphLoopHook(createMockPluginInput(), {
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: "done <promise>DONE</promise>" } })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		const stateAfterDone = hook.getState()

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		expect(hook.getState()?.iteration).toBe(stateAfterDone?.iteration)
		expect(promptCalls).toHaveLength(1)
		expect(hook.getState()?.verification_pending).toBe(true)
	})

	test("#given ulw loop is awaiting oracle verification #when oracle has not verified yet #then loop waits instead of continuing", async () => {
		const hook = createRalphLoopHook(createMockPluginInput(), {
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: "done <promise>DONE</promise>" } })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		writeState(testDir, {
			...hook.getState()!,
			verification_session_id: "ses-oracle",
		})
		writeFileSync(
			oracleTranscriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: "still checking" } })}\n`,
		)
		const stateBeforeWait = hook.getState()

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		expect(hook.getState()?.iteration).toBe(stateBeforeWait?.iteration)
		expect(promptCalls).toHaveLength(1)
		expect(hook.getState()?.verification_session_id).toBe("ses-oracle")
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
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: "done <promise>DONE</promise>" } })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		writeState(testDir, {
			...hook.getState()!,
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
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		expect(hook.getState()?.iteration).toBe(2)
		expect(hook.getState()?.max_iterations).toBeUndefined()
		expect(promptCalls[0].text).toContain("2/unbounded")
	})

	test("#given prior transcript completion from older run #when new ulw loop starts #then old completion is ignored", async () => {
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: "2000-01-01T00:00:00.000Z", tool_output: { output: "old <promise>DONE</promise>" } })}\n`,
		)
		const hook = createRalphLoopHook(createMockPluginInput(), {
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
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: "done <promise>DONE</promise>" } })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		hook.startLoop("session-123", "Restarted task", { ultrawork: true })

		expect(hook.getState()?.prompt).toBe("Restarted task")
		expect(hook.getState()?.verification_pending).toBeUndefined()
		expect(hook.getState()?.completion_promise).toBe("DONE")
	})

	test("#given parent session emits VERIFIED #when oracle session is not tracked #then ulw loop does not complete", async () => {
		const hook = createRalphLoopHook(createMockPluginInput(), {
			getTranscriptPath: (sessionID) => sessionID === "ses-oracle" ? oracleTranscriptPath : parentTranscriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: "done <promise>DONE</promise>" } })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		writeFileSync(
			parentTranscriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: "done <promise>DONE</promise>" } })}\n${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: `bad parent leak <promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>` } })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		expect(hook.getState()).not.toBeNull()
		expect(hook.getState()?.verification_pending).toBe(true)
	})
})
