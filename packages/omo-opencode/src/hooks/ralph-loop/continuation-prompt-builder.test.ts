/// <reference types="bun-types" />
// Failure mode decision: a fallback verifier without an Agent line inherits the
// existing 30-minute stuck-verification timeout, just like a non-compliant Oracle.
// No new state-machine branch is introduced for that case.
import { describe, expect, test } from "bun:test"
import { buildContinuationPrompt, buildVerificationFailurePrompt } from "./continuation-prompt-builder"
import type { RalphLoopState } from "./types"

const state: RalphLoopState = {
	active: true,
	iteration: 2,
	max_iterations: 10,
	completion_promise: "<promise>DONE</promise>",
	initial_completion_promise: "<promise>DONE</promise>",
	started_at: "2026-09-01T00:00:00.000Z",
	prompt: "Finish the task",
	ultrawork: true,
	verification_pending: true,
}

describe("ultrawork verification fallback prompts", () => {
	test("#given initial verification prompt #then includes category fallback chain tokens", () => {
		const prompt = buildContinuationPrompt(state)

		expect(prompt).toContain("task(subagent_type=\"oracle\"")
		expect(prompt).toContain("gate-verifier")
		expect(prompt).toContain('category: "deep"')
		expect(prompt).toContain("unspecified-high")
		expect(prompt).toContain("unspecified-low")
	})

	test("#given failed verification prompt #then includes category fallback chain tokens", () => {
		const prompt = buildVerificationFailurePrompt({ ...state, verification_pending: undefined })

		expect(prompt).toContain("task(subagent_type=\"oracle\"")
		expect(prompt).toContain("gate-verifier")
		expect(prompt).toContain('category: "deep"')
		expect(prompt).toContain("unspecified-high")
		expect(prompt).toContain("unspecified-low")
	})
})
