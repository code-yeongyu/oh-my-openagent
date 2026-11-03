import { describe, expect, test } from "bun:test"

import { DESIGN_SPEC_SECTIONS } from "./contracts.mjs"
import { parseLineageMode, parsePalette, renderDesignSpec } from "./design-spec.mjs"

function sectionBody(markdown: string, heading: string): string {
	const start = markdown.indexOf(`## ${heading}\n`)
	const rest = markdown.slice(start + heading.length + 4)
	const next = rest.search(/^## /m)
	return next === -1 ? rest : rest.slice(0, next)
}

describe("parsePalette", () => {
	test("#given a css fence and a Palette bullet list #when parsed #then the union is returned", () => {
		// given
		const spec = [
			"# Spec",
			"```css",
			":root { --bg: #FAF6EF; --accent: #c2410c; }",
			"```",
			"## Palette",
			"- accent #C2410C",
			"- good #15803d",
			"## Layout",
			"- divider #999999 is prose, not a token",
		].join("\n")
		// when
		const palette = parsePalette(spec)
		// then
		expect([...palette].sort()).toEqual(["#15803d", "#c2410c", "#faf6ef"])
	})

	test("#given Tokens and Colours headings with nested subheadings #when parsed #then hex under them counts", () => {
		// given
		const spec = [
			"## Tokens (copied from the reference)",
			"- Light: --bg #faf6ef, --fg #24211b",
			"### Dark",
			"- --bg #0c0b0a",
			"## Colours",
			"good #abc",
			"## Structure",
			"#def is not a color heading",
		].join("\n")
		// then
		expect([...parsePalette(spec)].sort()).toEqual(["#0c0b0a", "#24211b", "#aabbcc", "#faf6ef"])
	})

	test("#given a fence line starting with a hash #when parsed #then it is not read as a heading", () => {
		// given
		const spec = ["## Palette", "```", "# not a heading", "--x: #111111", "```", "- #222222"].join("\n")
		// then
		expect([...parsePalette(spec)].sort()).toEqual(["#111111", "#222222"])
	})

	test("#given a spec with no tokens #when parsed #then the palette is empty", () => {
		expect(parsePalette("# Spec\n\nPlain prose with #fff outside a palette.").size).toBe(0)
	})
})

describe("parseLineageMode", () => {
	test("#given a Lineage line under Citations #when parsed #then that mode is returned", () => {
		expect(parseLineageMode("## Citations\n- Style: bracket-S\n- Lineage: section\n")).toBe("section")
		expect(parseLineageMode("## Citations\nLineage: inline")).toBe("inline")
	})

	test("#given no Citations section or a Lineage line elsewhere #when parsed #then inline is the default", () => {
		expect(parseLineageMode("# Spec")).toBe("inline")
		expect(parseLineageMode("## Layout\nLineage: section\n## Citations\n- Style: footnote")).toBe("inline")
		expect(parseLineageMode("## Citations\nLineage: TODO: ask")).toBe("inline")
	})
})

describe("renderDesignSpec", () => {
	test("#given an empty extract #when rendered #then every section heading appears in order with TODO: ask under each", () => {
		// when
		const markdown = renderDesignSpec({})
		// then
		let cursor = -1
		for (const heading of DESIGN_SPEC_SECTIONS) {
			const index = markdown.indexOf(`## ${heading}\n`)
			expect(index, heading).toBeGreaterThan(cursor)
			cursor = index
			expect(sectionBody(markdown, heading), heading).toContain("TODO: ask")
		}
	})

	test("#given a full extract #when rendered #then values, provenance and a round-trippable palette and lineage appear", () => {
		// given
		const extract = {
			origin: "tests/fixtures/reference-report.html",
			bytes: 16500,
			date: "2026-09-24",
			tokens: {
				light: new Map([
					["--bg", "#faf6ef"],
					["--accent", "#c2410c"],
				]),
				dark: new Map([["--bg", "#0c0b0a"]]),
			},
			fonts: { body: "Pretendard, sans-serif", heading: "Pretendard, sans-serif", mono: "ui-monospace, monospace" },
			colors: [{ hex: "#24211b", count: 12, roles: ["body"] }],
			breakpoints: [560, 640],
			headingNumbering: "double-digit",
			citationStyle: "bracket-S",
			lineageMode: "section",
			figureContainers: ["fig"],
			skeleton: [
				{ level: 1, text: "Title" },
				{ level: 2, text: "01 Findings" },
			],
			measure: { fontSize: "17px", lineHeight: "1.75", maxWidth: "720px" },
			notes: ["skipped external stylesheet: theme.css"],
		}
		// when
		const markdown = renderDesignSpec(extract)
		// then
		const provenance = sectionBody(markdown, "Extracted from")
		expect(provenance).toContain("tests/fixtures/reference-report.html")
		expect(provenance).toContain("16500")
		expect(provenance).toContain("2026-09-24")
		expect(provenance).toContain("skipped external stylesheet: theme.css")
		expect([...parsePalette(markdown)].sort()).toEqual(["#0c0b0a", "#24211b", "#c2410c", "#faf6ef"])
		expect(parseLineageMode(markdown)).toBe("section")
		expect(sectionBody(markdown, "Layout")).toContain("560px, 640px")
		expect(sectionBody(markdown, "Structure")).toContain("  - 01 Findings")
		expect(sectionBody(markdown, "Figures")).toContain("fig")
		expect(sectionBody(markdown, "Open questions")).not.toContain("TODO: ask")
		for (const heading of ["Tokens", "Typography", "Layout", "Structure", "Figures", "Citations"]) {
			expect(sectionBody(markdown, heading), heading).not.toContain("TODO: ask")
		}
	})

	test("#given unknown enum values and plain-object tokens #when rendered #then unknowns are TODO: ask and listed as open questions", () => {
		// given
		const extract = { tokens: { light: { "--bg": "#ffffff" }, dark: {} }, lineageMode: "unknown", citationStyle: "unknown" }
		// when
		const markdown = renderDesignSpec(extract)
		// then
		expect(sectionBody(markdown, "Tokens")).toContain("--bg: #ffffff;")
		expect(sectionBody(markdown, "Tokens")).toContain("Dark tokens: TODO: ask")
		expect(sectionBody(markdown, "Citations")).toContain("Lineage: TODO: ask")
		expect(parseLineageMode(markdown)).toBe("inline")
		expect(sectionBody(markdown, "Open questions")).toContain("Lineage mode")
	})
})

describe("parsePalette with Korean headings", () => {
	test("#given a spec whose token section is headed in Korean #when parsed #then the bullet hexes under it are the palette", () => {
		// given
		const md = ["# design-spec", "## 토큰 (변경 금지)", "- 라이트: bg #faf6ef · fg #24211b · accent #c2410c", "## 그림 표준", "- 테두리 #ffffff"].join("\n")
		// when
		const palette = parsePalette(md)
		// then
		expect([...palette].sort()).toEqual(["#24211b", "#c2410c", "#faf6ef"])
	})

	test("#given Korean color and palette headings #when parsed #then each is recognized", () => {
		expect([...parsePalette("## 팔레트\n- #112233")]).toEqual(["#112233"])
		expect([...parsePalette("## 색상\n- #445566")]).toEqual(["#445566"])
	})
})
