import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createToolExecuteBeforeHandler } from "./tool-execute-before"
import { ULTRAWORK_VERIFICATION_PROMISE } from "../hooks/ralph-loop/constants"
import { clearState, writeState } from "../hooks/ralph-loop/storage"

describe("tool.execute.before ultrawork oracle verification", () => {
	function createCtx(directory: string) {
		return {
			directory,
			client: {
				session: {
					messages: async () => ({ data: [] }),
				},
			},
		}
	}

	test("#given ulw loop is awaiting verification #when oracle task runs #then oracle prompt is enforced and sync", async () => {
		const directory = join(tmpdir(), `tool-before-ulw-${Date.now()}`)
		mkdirSync(directory, { recursive: true })
		writeState(directory, {
			active: true,
			iteration: 3,
			completion_promise: ULTRAWORK_VERIFICATION_PROMISE,
			initial_completion_promise: "DONE",
			started_at: new Date().toISOString(),
			prompt: "Ship feature",
			session_id: "ses-main",
			ultrawork: true,
			verification_pending: true,
		})

		const handler = createToolExecuteBeforeHandler({
			ctx: createCtx(directory) as unknown as Parameters<typeof createToolExecuteBeforeHandler>[0]["ctx"],
			hooks: {} as Parameters<typeof createToolExecuteBeforeHandler>[0]["hooks"],
		})
		const output = {
			args: {
				subagent_type: "oracle",
				run_in_background: true,
				prompt: "Check it",
			} as Record<string, unknown>,
		}

		await handler({ tool: "task", sessionID: "ses-main", callID: "call-1" }, output)

		expect(output.args.run_in_background).toBe(false)
		expect(output.args.prompt).toContain("Ship feature")
		expect(output.args.prompt).toContain(`<promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>`)

		clearState(directory)
		rmSync(directory, { recursive: true, force: true })
	})

	test("#given ulw loop is not awaiting verification #when oracle task runs #then prompt is unchanged", async () => {
		const directory = join(tmpdir(), `tool-before-ulw-${Date.now()}-plain`)
		mkdirSync(directory, { recursive: true })
		const handler = createToolExecuteBeforeHandler({
			ctx: createCtx(directory) as unknown as Parameters<typeof createToolExecuteBeforeHandler>[0]["ctx"],
			hooks: {} as Parameters<typeof createToolExecuteBeforeHandler>[0]["hooks"],
		})
		const output = {
			args: {
				subagent_type: "oracle",
				run_in_background: true,
				prompt: "Check it",
			} as Record<string, unknown>,
		}

		await handler({ tool: "task", sessionID: "ses-main", callID: "call-1" }, output)

		expect(output.args.run_in_background).toBe(true)
		expect(output.args.prompt).toBe("Check it")

		rmSync(directory, { recursive: true, force: true })
	})
})
