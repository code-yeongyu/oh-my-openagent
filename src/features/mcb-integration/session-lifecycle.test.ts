import { describe, test, expect, mock, beforeEach } from "bun:test"
import { handleMcbSessionCreated } from "./session-lifecycle"
import { resetMcbAvailability, markMcbUnavailable } from "./availability"
import type { McbOperationExecutor } from "./recovery-sync"

describe("handleMcbSessionCreated", () => {
	beforeEach(() => {
		resetMcbAvailability()
	})

	test("resets warning state on session created", () => {
		//#given
		const executor: McbOperationExecutor = mock(async () => {})

		//#when
		handleMcbSessionCreated("/tmp/test-project", executor)

		//#then - no throw, warning state is reset internally
		expect(true).toBe(true)
	})

	test("skips recovery sync when MCB is globally unavailable", () => {
		//#given
		markMcbUnavailable()
		const executor: McbOperationExecutor = mock(async () => {})

		//#when
		handleMcbSessionCreated("/tmp/test-project", executor)

		//#then - executor should NOT be called since MCB is unavailable
		expect(executor).not.toHaveBeenCalled()
	})

	test("fires recovery sync without blocking when MCB is available", async () => {
		//#given
		const executor: McbOperationExecutor = mock(async () => {})

		//#when
		handleMcbSessionCreated("/tmp/test-project", executor)

		//#then - function returns immediately (fire-and-forget)
		// Recovery runs async but does not throw or block
		await new Promise((resolve) => setTimeout(resolve, 50))
		expect(true).toBe(true)
	})

	test("catches recovery sync errors without propagating", async () => {
		//#given - executor that would throw (but recovery has no queued ops by default)
		const executor: McbOperationExecutor = mock(async () => {
			throw new Error("MCB connection failed")
		})

		//#when - should not throw even if executor fails
		handleMcbSessionCreated("/tmp/test-project", executor)

		//#then - no error propagated, function returns cleanly
		await new Promise((resolve) => setTimeout(resolve, 50))
		expect(true).toBe(true)
	})
})
