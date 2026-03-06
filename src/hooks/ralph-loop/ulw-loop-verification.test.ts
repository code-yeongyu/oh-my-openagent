import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRalphLoopHook } from "./index"
import { ULTRAWORK_VERIFICATION_PROMISE } from "./constants"
import { clearState } from "./storage"

describe("ulw-loop verification", () => {
	const testDir = join(tmpdir(), `ulw-loop-verification-${Date.now()}`)
	let promptCalls: Array<{ sessionID: string; text: string }>
	let toastCalls: Array<{ title: string; message: string; variant: string }>
	let transcriptPath: string

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
		transcriptPath = join(testDir, "transcript.jsonl")

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
			getTranscriptPath: () => transcriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			transcriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: "done <promise>DONE</promise>" } })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		expect(hook.getState()?.verification_pending).toBe(true)
		expect(hook.getState()?.completion_promise).toBe(ULTRAWORK_VERIFICATION_PROMISE)
		expect(promptCalls).toHaveLength(1)
		expect(promptCalls[0].text).toContain('task(subagent_type="oracle"')
		expect(toastCalls.some((toast) => toast.title === "ULTRAWORK LOOP COMPLETE!")).toBe(false)
	})

	test("#given ulw loop is awaiting verification #when VERIFIED appears #then loop completes", async () => {
		const hook = createRalphLoopHook(createMockPluginInput(), {
			getTranscriptPath: () => transcriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			transcriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: "done <promise>DONE</promise>" } })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		writeFileSync(
			transcriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: "done <promise>DONE</promise>" } })}\n${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: `verified <promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>` } })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		expect(hook.getState()).toBeNull()
		expect(toastCalls.some((toast) => toast.title === "ULTRAWORK LOOP COMPLETE!")).toBe(true)
	})

	test("#given ulw loop without max iterations #when it continues #then it stays unbounded", async () => {
		const hook = createRalphLoopHook(createMockPluginInput(), {
			getTranscriptPath: () => transcriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		expect(hook.getState()?.iteration).toBe(2)
		expect(hook.getState()?.max_iterations).toBeUndefined()
		expect(promptCalls[0].text).toContain("2/unbounded")
	})

	test("#given prior transcript completion from older run #when new ulw loop starts #then old completion is ignored", async () => {
		writeFileSync(
			transcriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: "2000-01-01T00:00:00.000Z", tool_output: { output: "old <promise>DONE</promise>" } })}\n`,
		)
		const hook = createRalphLoopHook(createMockPluginInput(), {
			getTranscriptPath: () => transcriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })

		expect(hook.getState()?.iteration).toBe(2)
		expect(hook.getState()?.verification_pending).toBeUndefined()
		expect(promptCalls).toHaveLength(1)
	})

	test("#given ulw loop was awaiting verification #when same session starts again #then verification state is overwritten", async () => {
		const hook = createRalphLoopHook(createMockPluginInput(), {
			getTranscriptPath: () => transcriptPath,
		})
		hook.startLoop("session-123", "Build API", { ultrawork: true })
		writeFileSync(
			transcriptPath,
			`${JSON.stringify({ type: "tool_result", timestamp: new Date().toISOString(), tool_output: { output: "done <promise>DONE</promise>" } })}\n`,
		)

		await hook.event({ event: { type: "session.idle", properties: { sessionID: "session-123" } } })
		hook.startLoop("session-123", "Restarted task", { ultrawork: true })

		expect(hook.getState()?.prompt).toBe("Restarted task")
		expect(hook.getState()?.verification_pending).toBeUndefined()
		expect(hook.getState()?.completion_promise).toBe("DONE")
	})
})
