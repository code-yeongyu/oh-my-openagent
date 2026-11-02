import { describe, expect, test } from "bun:test"
import { lintSnapshot } from "./lint"
import type { PageRule } from "./rule"
import { buildSnapshot } from "./testing/build-snapshot"

const twoHits: PageRule = {
	meta: { id: "two-hits", name: "Two hits", category: "quality", severity: "error", engine: "page", description: "d", fixHint: "f" },
	check: () => [
		{ element: null, message: "default", snippet: "" },
		{ element: null, message: "softer", snippet: "", severity: "advisory" },
	],
}

describe("lintSnapshot severity", () => {
	test("#given a hit with its own severity #then it replaces the rule default for that hit only", () => {
		const findings = lintSnapshot(buildSnapshot([]), { rules: [twoHits] })
		expect(findings.map((f) => [f.message, f.severity])).toEqual([
			["default", "error"],
			["softer", "advisory"],
		])
	})

	test("#given a project override for the rule #then every hit takes the override", () => {
		const findings = lintSnapshot(buildSnapshot([]), { rules: [twoHits], config: { rules: { "two-hits": "warning" } } })
		expect(findings.map((f) => f.severity)).toEqual(["warning", "warning"])
	})
})
