import { describe, expect, mock, test } from "bun:test"

import { invokeTmuxSessionCreatedCallback } from "./tmux-callback-invoker"

const event = {
	sessionID: "child-session",
	parentID: "parent-session",
	title: "worker",
}

describe("invokeTmuxSessionCreatedCallback", () => {
	test("#given enabled tmux callback inside tmux #when invoked #then forwards the child session", async () => {
		// given
		const completed = Promise.withResolvers<void>()
		const callback = mock(async () => {
			completed.resolve()
		})

		// when
		invokeTmuxSessionCreatedCallback({
			callback,
			tmuxEnabled: true,
			suppress: false,
			...event,
			log: mock(() => undefined),
		})
		await completed.promise

		// then
		expect(callback).toHaveBeenCalledWith(event)
	})

	test("#given enabled callback outside literal tmux #when invoked #then delegates eligibility to the manager", () => {
		// given
		const callback = mock(async () => undefined)

		// when
		invokeTmuxSessionCreatedCallback({
			callback,
			tmuxEnabled: true,
			suppress: false,
			...event,
			log: mock(() => undefined),
		})

		// then
		expect(callback).toHaveBeenCalledWith(event)
	})
})
