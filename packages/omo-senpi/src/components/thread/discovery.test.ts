import { describe, expect, test } from "bun:test"

// The public @code-yeongyu/senpi export map exposes neither ToolSearchService
// nor normalizeToolExposure, so this test drives the installed package's
// compiled dist files directly. Everything under test is shipped code: the
// exposure normalization senpi's eval-only policy reads, catalog eligibility
// and the hidden-tool hint path of tool_search.
import { ToolSearchService } from "../../../node_modules/@code-yeongyu/senpi/dist/core/extensions/builtin/tool-search/service.js"
import { normalizeToolExposure } from "../../../node_modules/@code-yeongyu/senpi/dist/core/extensions/types.js"
import type { ToolInfo } from "../../../node_modules/@code-yeongyu/senpi/dist/core/extensions/types.js"

import { THREAD_FAMILY_PROMPT_GUIDELINES, THREAD_TOOL_EXPOSURE, THREAD_TOOL_METADATA, type ThreadToolEntry } from "./metadata"

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

function makeSourceInfo(path: string) {
	return { path, source: "test", scope: "project" as const, origin: "top-level" as const }
}

function entryToolInfos(entries: readonly ThreadToolEntry[]): ToolInfo[] {
	return entries.map((entry) => ({
		name: entry.name,
		label: entry.label,
		description: entry.description,
		parameters: sampleParameters,
		sourceInfo: makeSourceInfo("/virtual/components/thread/metadata.ts"),
		...normalizeToolExposure(entry),
	}))
}

/** A search-exposed competitor named `task`, the way senpi-task registers its rare tools. */
function taskCompetitorInfo(): ToolInfo {
	return {
		name: "task",
		label: "Task",
		description: "Spawn a background worker task as a child of this session.",
		parameters: sampleParameters,
		sourceInfo: makeSourceInfo("/virtual/fixture.ts"),
		exposure: "search",
		searchKeywords: [],
		allowLazyActivation: true,
	}
}

// No stale state is possible: every test builds a fresh service over an
// in-memory runtime, and search() re-derives the catalog and index per call.
function createServiceWithTools(tools: readonly ToolInfo[]): ToolSearchService {
	const active: string[] = []
	return new ToolSearchService({
		getAllTools: () => [...tools],
		getActiveTools: () => [...active],
		setActiveTools: (names) => {
			active.length = 0
			active.push(...names)
		},
	})
}

describe("thread tool exposure as senpi's eval-only policy reads it", () => {
	test("every entry normalizes to the eval exposure that joins the policy", () => {
		// given the eighteen entries
		for (const entry of THREAD_TOOL_METADATA) {
			// when senpi normalizes the definition the way _resolveEvalOnlyToolNames does
			const normalized = normalizeToolExposure(entry)
			// then the tool is eval-exposed and carries nothing the search catalog would index
			expect(normalized.exposure, entry.name).toBe("eval")
			expect(normalized.searchText, entry.name).toBeUndefined()
			expect(normalized.searchKeywords, entry.name).toEqual([])
		}
		expect(THREAD_TOOL_EXPOSURE).toBe("eval")
	})

	test("the tool-search catalog indexes none of the family while a search competitor stays searchable", () => {
		// given the family beside one search-exposed competitor
		const service = createServiceWithTools([...entryToolInfos(THREAD_TOOL_METADATA), taskCompetitorInfo()])
		// when the catalog is derived
		const catalog = service.getCatalog().map((doc) => doc.name)
		// then only the competitor is a search document
		expect(catalog).toEqual(["task"])
		expect(service.search("message another session that is already running").map((result) => result.name)).not.toContain("thread_send")
	})

	test("a query naming a thread tool answers with the host's eval redirect hint", () => {
		// given a host that publishes removed-tool hints for the withheld family
		const service = createServiceWithTools(entryToolInfos(THREAD_TOOL_METADATA))
		const hint = "Run thread_send inside an eval cell via tool.thread_send({ ... }); hooks and permissions still apply."
		service.bindRemovedToolHints(() => ({ thread_send: hint }))
		// when the model searches for the tool by name (the shipped matcher compares the whole query and its
		// whitespace tokens against the hidden names, so a sentence embedding the name is not a lookup)
		const hints = service.hiddenToolHints("thread_send")
		// then the redirect names the tool and its eval form
		expect(hints).toEqual([{ name: "thread_send", hint }])
		expect(service.hiddenToolHints("thread_list")).toEqual([])
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
