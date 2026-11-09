import { describe, expect, test } from "bun:test"

import { THREAD_FAMILY_PROMPT_GUIDELINES, THREAD_TOOL_METADATA } from "./metadata"

const THREAD_TOOL_NAMES = [
	"thread_create",
	"thread_list",
	"thread_read",
	"thread_send",
	"thread_interrupt",
	"thread_close",
	"thread_handoff",
	"thread_rename",
	"thread_set_model",
	"thread_set_reasoning",
	"thread_bind",
	"thread_unbind",
	"thread_rebind",
	"thread_bindings",
	"thread_report",
	"thread_outbox",
	"thread_outbox_ack",
	"thread_answer",
] as const

describe("thread family metadata shape", () => {
	test("the family carries eighteen entries with unique names", () => {
		expect(THREAD_TOOL_METADATA.map((entry) => entry.name)).toEqual([...THREAD_TOOL_NAMES])
		const names = THREAD_TOOL_METADATA.map((entry) => entry.name)
		expect(new Set(names).size).toBe(names.length)
	})

	test("every label leads with its verb, pinned literally", () => {
		expect(THREAD_TOOL_METADATA.map((entry) => entry.label)).toEqual([
			"Create session",
			"List sessions",
			"Read session",
			"Send message to session",
			"Interrupt session turn",
			"Close session",
			"Hand off session",
			"Rename session",
			"Switch session model",
			"Set session reasoning level",
			"Bind session to chat thread",
			"Unbind chat thread",
			"Rebind chat thread",
			"List chat bindings",
			"Report to chat thread",
			"Read chat outbox",
			"Acknowledge chat outbox",
			"Answer relayed question",
		])
	})

	test("every entry is eval-exposed", () => {
		for (const entry of THREAD_TOOL_METADATA) {
			expect(entry.exposure, entry.name).toBe("eval")
			expect("searchKeywords" in entry, entry.name).toBe(false)
		}
	})

	test("the family policy lives in exactly one guidelines entry", () => {
		// given the per-tool entries
		for (const entry of THREAD_TOOL_METADATA) {
			expect("promptGuidelines" in entry, entry.name).toBe(false)
		}
		// then a single non-empty family string carries it
		expect(typeof THREAD_FAMILY_PROMPT_GUIDELINES).toBe("string")
		expect(THREAD_FAMILY_PROMPT_GUIDELINES.length).toBeGreaterThan(0)
	})
})
