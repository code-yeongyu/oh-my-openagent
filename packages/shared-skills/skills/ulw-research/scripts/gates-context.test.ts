import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { parseLineageMode, parsePalette } from "./design-spec.mjs"
import * as gatesStatic from "./gates-static.mjs"
import * as gatesStructure from "./gates-structure.mjs"
import { parseHtml } from "./html-lite.mjs"

const FIXTURES = join(import.meta.dir, "tests", "fixtures")
const GOOD = readFileSync(join(FIXTURES, "good-report.html"), "utf8")
const SPEC = readFileSync(join(FIXTURES, "design-spec.md"), "utf8")

type BuildContext = (doc: unknown, options: Record<string, unknown>) => Record<string, unknown>

function buildContextExport(): BuildContext {
	const buildContext = (gatesStatic as Record<string, unknown>).buildContext
	if (typeof buildContext !== "function") throw new Error("buildContext is not exported")
	return buildContext as BuildContext
}

describe("static-gate context exports", () => {
	test("#given gates-static #when imported #then buildContext is an exported function", () => {
		// given
		const exported = (gatesStatic as Record<string, unknown>).buildContext
		// when
		const kind = typeof exported
		// then
		expect(kind).toBe("function")
	})

	test("#given the passing fixture report #when buildContext runs #then the walk, sections and helpers are present", () => {
		// given
		const buildContext = buildContextExport()
		const options = { palette: parsePalette(SPEC), lineageMode: parseLineageMode(SPEC), requireSections: [], baseDir: FIXTURES }
		// when
		const ctx = buildContext(parseHtml(GOOD), options) as {
			elements: unknown[]
			texts: unknown[]
			sections: { kind: string | null }[]
			util: { hasCitation: unknown; citationMarker: unknown }
			kindOf: unknown
		}
		// then
		expect(ctx.elements.length).toBeGreaterThan(0)
		expect(ctx.texts.length).toBeGreaterThan(0)
		expect(ctx.sections.length).toBeGreaterThan(0)
		expect(ctx.sections.map((section) => section.kind)).toContain("sources")
		expect(typeof ctx.util.hasCitation).toBe("function")
		expect(ctx.util.citationMarker).toBeInstanceOf(RegExp)
		expect(typeof ctx.kindOf).toBe("function")
	})

	test("#given gates-structure #when imported #then UNCHECKED_KINDS lists the closing and sources kinds", () => {
		// given
		const unchecked = (gatesStructure as Record<string, unknown>).UNCHECKED_KINDS as Set<string> | undefined
		// when
		const kinds = unchecked ? [...unchecked] : []
		// then
		expect(unchecked).toBeInstanceOf(Set)
		expect(kinds).toContain("closing")
		expect(kinds).toContain("sources")
	})
})
