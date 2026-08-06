import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { showToastBestEffort } from "./event-handler-feedback"

const TOAST_BODY = {
	title: "Ralph Loop",
	message: "status",
	variant: "info",
	duration: 1000,
} as const
const NON_ERROR_FAILURE = { reason: "toast unavailable" } as const

function createContext(showToast: () => unknown): PluginInput {
	return unsafeTestValue<PluginInput>({
		client: {
			tui: { showToast },
		},
	})
}

describe("showToastBestEffort", () => {
	test("#given showToast throws synchronously #when toast is shown #then error is swallowed", () => {
		// given
		const ctx = createContext(() => {
			throw NON_ERROR_FAILURE
		})

		// when
		const run = () => showToastBestEffort(ctx, TOAST_BODY)

		// then
		expect(run).not.toThrow()
	})

	test("#given showToast rejects asynchronously #when toast is shown #then rejection is swallowed", async () => {
		// given
		const ctx = createContext(() => Promise.reject(NON_ERROR_FAILURE))

		// when
		showToastBestEffort(ctx, TOAST_BODY)
		await Promise.resolve()

		// then
		expect(true).toBe(true)
	})
})
