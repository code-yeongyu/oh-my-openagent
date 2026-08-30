import { describe, expect, test } from "bun:test"

// The public @code-yeongyu/senpi export map exposes neither ToolSearchService
// nor the search engine, so this test drives the installed package's compiled
// dist file directly. Everything under test is shipped code: catalog
// eligibility, extension-document derivation, and the BM25 index are all real.
import { ToolSearchService } from "../../../node_modules/@code-yeongyu/senpi/dist/core/extensions/builtin/tool-search/service.js"
import type { ToolInfo } from "../../../node_modules/@code-yeongyu/senpi/dist/core/extensions/types.js"

import { THREAD_FAMILY_PROMPT_GUIDELINES, type ThreadToolSearchEntry, THREAD_TOOL_SEARCH_METADATA } from "./metadata"

const THREAD_TOOL_NAMES = [
	"thread_create",
	"thread_list",
	"thread_read",
	"thread_send",
	"thread_interrupt",
	"thread_handoff",
] as const

const sampleParameters: ToolInfo["parameters"] = {
	type: "object",
	properties: {},
	required: [],
}

function makeSourceInfo(path: string) {
	return { path, source: "test", scope: "project" as const, origin: "top-level" as const }
}

function entryToolInfos(entries: readonly ThreadToolSearchEntry[]): ToolInfo[] {
	return entries.map((entry) => ({
		name: entry.name,
		label: entry.label,
		description: entry.description,
		parameters: sampleParameters,
		sourceInfo: makeSourceInfo("/virtual/components/thread/metadata.ts"),
		exposure: entry.exposure,
		searchText: entry.searchText,
		searchKeywords: entry.searchKeywords,
		searchGroup: entry.group,
		allowLazyActivation: entry.allowLazyActivation,
	}))
}

function bareToolInfos(names: readonly string[]): ToolInfo[] {
	return names.map((name) => ({
		name,
		label: name,
		description: "",
		parameters: sampleParameters,
		sourceInfo: makeSourceInfo("/virtual/components/thread/metadata.ts"),
		exposure: "search",
		searchKeywords: [],
		allowLazyActivation: true,
	}))
}

/** Minimal competitor named `task`: name, label, one sentence, nothing else. */
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

describe("thread tool discovery through the real tool-search service", () => {
	test("bare names leave thread_send unranked for a message query", () => {
		// given the six tools registered with bare names and no search text
		const service = createServiceWithTools(bareToolInfos(THREAD_TOOL_NAMES))
		// when the user phrasing for messaging a live session is searched
		const results = service.search("message another session that is already running")
		// then no bare document matches it, so ranking must come from the metadata
		expect(results.find((result) => result.name === "thread_send")).toBeUndefined()
	})

	test("each intent phrase ranks its intended tool first", () => {
		// given the six tools carrying their full search metadata
		const service = createServiceWithTools(entryToolInfos(THREAD_TOOL_SEARCH_METADATA))
		const cases: ReadonlyArray<readonly [query: string, expected: string]> = [
			["create a new parallel session", "thread_create"],
			["list my saved sessions", "thread_list"],
			["read what another session output", "thread_read"],
			["message another session that is already running", "thread_send"],
			["stop the turn running in another session", "thread_interrupt"],
			["hand this off to the old session about the payments bug", "thread_handoff"],
		]
		for (const [query, expected] of cases) {
			// when each user phrase goes through the real BM25 scorer
			const results = service.search(query)
			// then the intended tool is the top result
			expect(results[0]?.name, `top-1 for "${query}"`).toBe(expected)
		}
	})

	test("a spawn-worker query ranks the task competitor above every thread tool", () => {
		// given the full family plus a minimal bare competitor named task
		const service = createServiceWithTools([...entryToolInfos(THREAD_TOOL_SEARCH_METADATA), taskCompetitorInfo()])
		// when the user asks to spawn background work
		const results = service.search("spawn a background worker task")
		// then the competitor wins and the routing clauses do not cannibalize it
		expect(results[0]?.name).toBe("task")
	})

	test("no keyword string repeats across the six tools", () => {
		const all = THREAD_TOOL_SEARCH_METADATA.flatMap((entry) => [...entry.searchKeywords])
		expect(new Set(all).size).toBe(all.length)
	})

	test("every tool carries 4 to 6 keywords", () => {
		for (const entry of THREAD_TOOL_SEARCH_METADATA) {
			expect(entry.searchKeywords.length, entry.name).toBeGreaterThanOrEqual(4)
			expect(entry.searchKeywords.length, entry.name).toBeLessThanOrEqual(6)
		}
	})

	test("the family policy lives in exactly one guidelines entry", () => {
		// given the per-tool entries
		for (const entry of THREAD_TOOL_SEARCH_METADATA) {
			expect("promptGuidelines" in entry, entry.name).toBe(false)
		}
		// then a single non-empty family string carries it
		expect(typeof THREAD_FAMILY_PROMPT_GUIDELINES).toBe("string")
		expect(THREAD_FAMILY_PROMPT_GUIDELINES.length).toBeGreaterThan(0)
	})

	test("indexed text contains no negated-use wording", () => {
		// BM25 indexes negated words positively, so indexed fields must route instead
		for (const entry of THREAD_TOOL_SEARCH_METADATA) {
			const indexed = [entry.description, entry.searchText, ...entry.searchKeywords]
			for (const text of indexed) {
				expect(text.match(/\b(?:not|never)\b/i), `${entry.name}: ${text}`).toBeNull()
			}
		}
	})
})
