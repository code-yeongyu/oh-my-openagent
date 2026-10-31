import { describe, expect, test } from "bun:test"

import { buildContext, checkStatic } from "./gates-static.mjs"
import { parseHtml } from "./html-lite.mjs"

describe("HTML exact Closing headings", () => {
	test.each([
		["Closing", "closing", false],
		["Closing the gap: GPU prices", null, true],
	] as const)("#given %s as an HTML heading #when checked #then closing scope matches the whole heading", (heading: string, kind: string | null, missing: boolean) => {
		const root = parseHtml(`<h2>${heading}</h2><p>Prices fell 8%.</p>`)
		expect(buildContext(root, {}).sections.map((section: { kind: string | null }) => section.kind)).toEqual([kind])
		const { defects } = checkStatic(root, {})
		expect(defects.some((defect) => "code" in defect && defect.code === "missing_closing_section")).toBe(missing)
		expect(defects.some((defect) => "code" in defect && defect.code === "unsourced_number")).toBe(missing)
	})
})
