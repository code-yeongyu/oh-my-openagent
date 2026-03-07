/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { verifyCompletion } from "./completion-verifier"

function createMockCtx(overrides?: {
	createResult?: { data?: { id?: string }; error?: unknown }
	promptResult?: unknown
	messagesResult?: unknown[]
	messagesError?: Error
	createError?: Error
}) {
	const calls = {
		create: [] as unknown[],
		prompt: [] as unknown[],
		messages: [] as unknown[],
	}

	return {
		ctx: {
			client: {
				session: {
					create: async (opts: unknown) => {
						calls.create.push(opts)
						if (overrides?.createError) throw overrides.createError
						return overrides?.createResult ?? { data: { id: "verify-session-1" } }
					},
					prompt: async (opts: unknown) => {
						calls.prompt.push(opts)
						return overrides?.promptResult ?? {}
					},
					messages: async (opts: unknown) => {
						calls.messages.push(opts)
						if (overrides?.messagesError) throw overrides.messagesError
						return { data: overrides?.messagesResult ?? [] }
					},
					delete: async () => {},
				},
			},
			directory: "/tmp/test",
		} as unknown as Parameters<typeof verifyCompletion>[0],
		calls,
	}
}

describe("completion-verifier", () => {
	//#given a completion with valid verification response PASS
	//#when verifyCompletion is called
	//#then it returns { verified: true }
	test("should return verified=true when agent responds with PASS", async () => {
		const { ctx } = createMockCtx({
			messagesResult: [
				{ info: { role: "user" }, parts: [{ type: "text", text: "Verify..." }] },
				{
					info: { role: "assistant" },
					parts: [{ type: "text", text: "Everything looks good. <verification>PASS</verification>" }],
				},
			],
		})

		const result = await verifyCompletion(ctx, {
			sessionID: "parent-session",
			directory: "/tmp/test",
			completionPromise: "DONE",
			prompt: "Build a REST API",
			iteration: 3,
			timeoutMs: 1000,
			pollIntervalMs: 10,
		})

		expect(result.verified).toBe(true)
		expect(result.reason).toBeUndefined()
	})

	//#given a completion with FAIL verification response
	//#when verifyCompletion is called
	//#then it returns { verified: false, reason: "..." }
	test("should return verified=false with reason when agent responds with FAIL", async () => {
		const { ctx } = createMockCtx({
			messagesResult: [
				{ info: { role: "user" }, parts: [{ type: "text", text: "Verify..." }] },
				{
					info: { role: "assistant" },
					parts: [{ type: "text", text: "<verification>FAIL: Tests are not passing</verification>" }],
				},
			],
		})

		const result = await verifyCompletion(ctx, {
			sessionID: "parent-session",
			directory: "/tmp/test",
			completionPromise: "DONE",
			prompt: "Build a REST API",
			iteration: 3,
			timeoutMs: 1000,
			pollIntervalMs: 10,
		})

		expect(result.verified).toBe(false)
		expect(result.reason).toBe("Tests are not passing")
	})

	//#given a verification that times out
	//#when verifyCompletion is called with short timeout
	//#then it returns { verified: true } (don't block)
	test("should return verified=true on timeout (don't block completion)", async () => {
		const { ctx } = createMockCtx({
			messagesResult: [],
		})

		const result = await verifyCompletion(ctx, {
			sessionID: "parent-session",
			directory: "/tmp/test",
			completionPromise: "DONE",
			prompt: "Build a REST API",
			iteration: 3,
			timeoutMs: 50,
			pollIntervalMs: 10,
		})

		expect(result.verified).toBe(true)
	})

	//#given a session creation failure
	//#when verifyCompletion is called
	//#then it returns { verified: true } (don't block on infra errors)
	test("should return verified=true when session creation fails", async () => {
		const { ctx } = createMockCtx({
			createError: new Error("Session creation failed"),
		})

		const result = await verifyCompletion(ctx, {
			sessionID: "parent-session",
			directory: "/tmp/test",
			completionPromise: "DONE",
			prompt: "Build a REST API",
			iteration: 3,
			timeoutMs: 1000,
			pollIntervalMs: 10,
		})

		expect(result.verified).toBe(true)
	})

	//#given a verification with invalid/unparseable response
	//#when verifyCompletion is called
	//#then it returns { verified: true } (assume pass on parse errors)
	test("should return verified=true when response has no verification tag", async () => {
		const { ctx } = createMockCtx({
			messagesResult: [
				{ info: { role: "user" }, parts: [{ type: "text", text: "Verify..." }] },
				{
					info: { role: "assistant" },
					parts: [{ type: "text", text: "I reviewed the work and it looks fine." }],
				},
			],
		})

		const result = await verifyCompletion(ctx, {
			sessionID: "parent-session",
			directory: "/tmp/test",
			completionPromise: "DONE",
			prompt: "Build a REST API",
			iteration: 3,
			timeoutMs: 1000,
			pollIntervalMs: 10,
		})

		expect(result.verified).toBe(true)
	})

	//#given a valid verification call
	//#when verifyCompletion is called
	//#then it creates a session and sends the correct prompt
	test("should create session and send verification prompt with correct agent", async () => {
		const { ctx, calls } = createMockCtx({
			messagesResult: [
				{
					info: { role: "assistant" },
					parts: [{ type: "text", text: "<verification>PASS</verification>" }],
				},
			],
		})

		await verifyCompletion(ctx, {
			sessionID: "parent-session",
			directory: "/tmp/test",
			completionPromise: "DONE",
			prompt: "Build a REST API",
			iteration: 3,
			agent: "merovingian",
			timeoutMs: 1000,
			pollIntervalMs: 10,
		})

		expect(calls.create.length).toBe(1)
		expect(calls.prompt.length).toBe(1)

		const promptCall = calls.prompt[0] as {
			path: { id: string }
			body: { agent: string; parts: Array<{ type: string; text: string }> }
		}
		expect(promptCall.body.agent).toBe("merovingian")
		expect(promptCall.body.parts[0].text).toContain("Build a REST API")
		expect(promptCall.body.parts[0].text).toContain("3 iteration(s)")
		expect(promptCall.body.parts[0].text).toContain("DONE")
	})

	//#given a session create returns error in result (not throw)
	//#when verifyCompletion is called
	//#then it returns { verified: true } (don't block)
	test("should return verified=true when session create returns error result", async () => {
		const { ctx } = createMockCtx({
			createResult: { error: "Something went wrong" },
		})

		const result = await verifyCompletion(ctx, {
			sessionID: "parent-session",
			directory: "/tmp/test",
			completionPromise: "DONE",
			prompt: "Build a REST API",
			iteration: 3,
			timeoutMs: 1000,
			pollIntervalMs: 10,
		})

		expect(result.verified).toBe(true)
	})
})
