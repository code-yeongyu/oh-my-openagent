import { describe, expect, it } from "bun:test"
import { getIsolatedSessionName } from "./session-spawn"

describe("getIsolatedSessionName", () => {
	it("returns the same tmux session name for the same server URL", () => {
		const first = getIsolatedSessionName("http://127.0.0.1:4096")
		const second = getIsolatedSessionName("http://127.0.0.1:4096")

		expect(first).toBe(second)
		expect(first).toMatch(/^omo-agents-[a-f0-9]{10}$/)
	})

	it("uses different tmux session names for different plugin server URLs", () => {
		const first = getIsolatedSessionName("http://127.0.0.1:4096")
		const second = getIsolatedSessionName("http://127.0.0.1:4097")

		expect(first).not.toBe(second)
	})
})