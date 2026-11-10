import { describe, expect, test } from "bun:test"

// The public @code-yeongyu/senpi export map exposes neither ToolSearchService nor the search
// engine, so this test drives the installed package's compiled dist file directly: the
// catalog eligibility under test is shipped code.
import { ToolSearchService } from "../../../node_modules/@code-yeongyu/senpi/dist/core/extensions/builtin/tool-search/service.js"
import type { ToolInfo } from "../../../node_modules/@code-yeongyu/senpi/dist/core/extensions/types.js"

import { THREAD_FAMILY_PROMPT_GUIDELINES, THREAD_TOOL_EXPOSURE, THREAD_TOOL_METADATA } from "./metadata"

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

const sampleParameters: ToolInfo["parameters"] = {
	type: "object",
	properties: {},
	required: [],
}

function entryToolInfos(): ToolInfo[] {
	return THREAD_TOOL_METADATA.map((entry) => ({
		name: entry.name,
		label: entry.label,
		description: entry.description,
		parameters: sampleParameters,
		sourceInfo: { path: "/virtual/components/thread/metadata.ts", source: "test", scope: "project" as const, origin: "top-level" as const },
		exposure: entry.exposure,
		searchKeywords: [],
		allowLazyActivation: true,
	}))
}

describe("thread tools and the real tool-search service", () => {
	test("eval-exposed entries are not in the catalog and a session query finds none of them", () => {
		// given the eighteen tools registered with their shipped metadata
		const active: string[] = []
		const service = new ToolSearchService({
			getAllTools: () => entryToolInfos(),
			getActiveTools: () => [...active],
			setActiveTools: (names) => {
				active.length = 0
				active.push(...names)
			},
		})
		// when the catalog is built and the user phrasing for messaging a session is searched
		const catalog = service.getCatalog().map((doc) => doc.name)
		const results = service.search("message another session that is already running").map((result) => result.name)
		// then no thread tool is indexed, none is found, and the search activated nothing
		expect(catalog.filter((name) => name.startsWith("thread_"))).toEqual([])
		expect(results.filter((name) => name.startsWith("thread_"))).toEqual([])
		expect(active).toEqual([])
	})
})

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
			expect(entry.exposure, entry.name).toBe(THREAD_TOOL_EXPOSURE)
			expect(THREAD_TOOL_EXPOSURE).toBe("eval")
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
