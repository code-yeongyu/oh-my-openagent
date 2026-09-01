import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { restoreModuleMocksForTestFile } from "../../../testing/module-mock-lifecycle"
import type { PreToolUseContext } from "../pre-tool-use"

type PreToolUseMockResult = {
	readonly decision?: "deny" | "allow"
	readonly reason?: string
	readonly toolName?: string
	readonly hookName?: string
	readonly elapsedMs?: number
	readonly inputLines?: string
	readonly modifiedInput?: Record<string, unknown>
}

let preToolUseResult: PreToolUseMockResult = { decision: "allow" }
let preToolUseContexts: PreToolUseContext[] = []
const mockGetWorkForSession = mock(() => null)

mock.module("../config", () => ({
	loadClaudeHooksConfig: async () => ({}),
}))

mock.module("../config-loader", () => ({
	loadPluginExtendedConfig: async () => ({}),
}))

mock.module("../pre-tool-use", () => ({
	executePreToolUseHooks: async (context: PreToolUseContext) => {
		preToolUseContexts.push(context)
		return preToolUseResult
	},
}))

mock.module("../../../features/boulder-state", () => ({
	getWorkForSession: mockGetWorkForSession,
}))

afterAll(() => {
	mock.restore()
	restoreModuleMocksForTestFile(import.meta.url)
})

const { createToolExecuteBeforeHandler } = await import("./tool-execute-before-handler")

describe("createToolExecuteBeforeHandler", () => {
	beforeEach(() => {
		preToolUseResult = { decision: "allow" }
		preToolUseContexts = []
		mockGetWorkForSession.mockReset()
		mockGetWorkForSession.mockReturnValue(null)
	})

	it("#given Bash has an active tool cwd #when handler runs #then PreToolUse receives that cwd", async () => {
		// given
		const handler = createToolExecuteBeforeHandler(
			{
				client: {
					tui: {
						showToast: async () => ({}),
					},
				},
				directory: "/session-repo",
			} as never,
			{},
		)

		// when
		await handler(
			{ tool: "bash", sessionID: "ses_test", callID: "call_test" },
			{ args: { command: "git status", cwd: "/active-worktree" } },
		)

		// then
		expect(preToolUseContexts).toHaveLength(1)
		expect(preToolUseContexts[0]?.cwd).toBe("/active-worktree")
		expect(preToolUseContexts[0]?.toolInput).toEqual({
			command: "git status",
			cwd: "/active-worktree",
		})
	})

	it("#given Bash lacks an explicit cwd but session has a tracked worktree #when handler runs #then PreToolUse receives the tracked worktree", async () => {
		// given
		mockGetWorkForSession.mockReturnValue({
			work_id: "work-1",
			active_plan: ".omo/plans/plan.md",
			plan_name: "plan",
			status: "active",
			started_at: "2026-07-07T00:00:00.000Z",
			updated_at: "2026-07-07T00:00:01.000Z",
			session_ids: ["ses_test"],
			worktree_path: "/tracked-worktree",
		})
		const handler = createToolExecuteBeforeHandler(
			{
				client: {
					tui: {
						showToast: async () => ({}),
					},
				},
				directory: "/session-repo",
				worktree: "/plugin-worktree",
			} as never,
			{},
		)

		// when
		await handler(
			{ tool: "bash", sessionID: "ses_test", callID: "call_test" },
			{ args: { command: "git status" } },
		)

		// then
		expect(mockGetWorkForSession).toHaveBeenCalledWith("/session-repo", "ses_test")
		expect(preToolUseContexts).toHaveLength(1)
		expect(preToolUseContexts[0]?.cwd).toBe("/tracked-worktree")
	})

	it("#given todowrite JSON parsing throws a non-Error value #when handler runs #then it reports the same parse error", async () => {
		// given
		const thrownValue = "parse failed"
		const parseSpy = spyOn(JSON, "parse").mockImplementation(() => {
			throw thrownValue
		})
		const handler = createToolExecuteBeforeHandler(
			{
				client: {
					tui: {
						showToast: async () => ({}),
					},
				},
				directory: "/repo",
			} as never,
			{},
		)

		try {
			// when
			const action = handler(
				{ tool: "todowrite", sessionID: "ses_test", callID: "call_test" },
				{ args: { todos: "[]" } },
			)

			// then
			await expect(action).rejects.toThrow("[todowrite ERROR] Failed to parse todos string as JSON")
		} finally {
			parseSpy.mockRestore()
		}
	})

	it("#given denial toast rejects with a non-Error value #when hook denies #then the hook denial still wins", async () => {
		// given
		const thrownValue = "toast failed"
		preToolUseResult = {
			decision: "deny",
			reason: "blocked by hook",
			toolName: "Write",
			hookName: "guard",
		}
		const handler = createToolExecuteBeforeHandler(
			{
				client: {
					tui: {
						showToast: async () => {
							throw thrownValue
						},
					},
				},
				directory: "/repo",
			} as never,
			{},
		)

		// when
		const action = handler(
			{ tool: "write", sessionID: "ses_test", callID: "call_test" },
			{ args: { filePath: "a.ts" } },
		)

		// then
		await expect(action).rejects.toThrow("blocked by hook")
	})
})
