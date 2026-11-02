import { describe, expect, test } from "bun:test"

import * as gatesStatic from "./gates-static.mjs"
import { parseHtml } from "./html-lite.mjs"
import * as mdLite from "./md-lite.mjs"
import { parseMarkdown, sectionKindsMd } from "./md-lite.mjs"

type Cell = { text: string; start: number; end: number }
type Block = { kind: string; level?: number; text: string; start: number; end: number; cells?: Cell[] }

const FIXTURE = [
	"# 반도체 시장 보고서",
	"",
	"매출은 {{F1}}로 집계됐다. Revenue grew",
	"across two quarters.",
	"",
	"## Findings",
	"",
	"- 첫 번째 항목 120억 원",
	"* Second item 3.2 m",
	"1. Ordered item 45%",
	"",
	"| 지표 | Value |",
	"| --- | ---: |",
	"| 매출 | 100억 원 |",
	"",
	"> 원문 인용 그대로다.",
	"",
	"```js",
	"const total = 9999",
	"```",
	"",
	"## Sources",
	"",
	"S1 example.org",
	"",
	"## 출처",
	"",
	"## Closing",
	"",
	"### Method",
	"",
	"## 마무리",
	"",
].join("\n")

function blocksOf(text: string): Block[] {
	return (parseMarkdown(text) as { blocks: Block[] }).blocks
}

function expectSlices(text: string, blocks: Block[]): void {
	for (const block of blocks) {
		expect(text.slice(block.start, block.end)).toBe(block.text)
		for (const cell of block.cells ?? []) expect(text.slice(cell.start, cell.end)).toBe(cell.text)
	}
}

describe("parseMarkdown", () => {
	test("#given a Korean+English fixture #when parsed #then block kinds come in document order", () => {
		// given
		const text = FIXTURE
		// when
		const blocks = blocksOf(text)
		// then
		expect(blocks.map((b) => b.kind)).toEqual([
			"heading",
			"paragraph",
			"heading",
			"list_item",
			"list_item",
			"list_item",
			"table_row",
			"table_row",
			"blockquote",
			"code",
			"heading",
			"paragraph",
			"heading",
			"heading",
			"heading",
			"heading",
		])
	})

	test("#given the fixture #when parsed #then every block and cell slices exactly from start to end", () => {
		// given
		const text = FIXTURE
		// when
		const blocks = blocksOf(text)
		// then
		expectSlices(text, blocks)
		expect(blocks[0]).toMatchObject({ kind: "heading", level: 1, text: "반도체 시장 보고서" })
		expect(blocks[1]?.text).toBe("매출은 {{F1}}로 집계됐다. Revenue grew\nacross two quarters.")
		expect(blocks.filter((b) => b.kind === "list_item").map((b) => b.text)).toEqual([
			"첫 번째 항목 120억 원",
			"Second item 3.2 m",
			"Ordered item 45%",
		])
		expect(blocks.find((b) => b.kind === "blockquote")?.text).toBe("원문 인용 그대로다.")
	})

	test("#given a table with a separator row #when parsed #then rows carry trimmed cells and the separator is skipped", () => {
		// given
		const text = FIXTURE
		// when
		const rows = blocksOf(text).filter((b) => b.kind === "table_row")
		// then
		expect(rows.map((r) => (r.cells ?? []).map((c) => c.text))).toEqual([
			["지표", "Value"],
			["매출", "100억 원"],
		])
		expectSlices(text, rows)
	})

	test("#given a fenced code block with numerals #when parsed #then the numerals sit only in a block of kind code", () => {
		// given
		const text = FIXTURE
		// when
		const blocks = blocksOf(text)
		// then
		const holders = blocks.filter((b) => b.text.includes("9999"))
		expect(holders.map((b) => b.kind)).toEqual(["code"])
		expect(holders[0]?.text).toBe("const total = 9999")
	})

	test("#given an unterminated code fence #when parsed #then it is code to EOF and an unterminated_fence problem names its line", () => {
		// given
		const text = "Intro 12.\n\n```\nlet a = 1\n## not a heading\n"
		// when
		const { blocks, problems } = parseMarkdown(text) as { blocks: Block[]; problems: { code: string; line: number }[] }
		// then
		expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "code"])
		expect(blocks[1]?.text).toBe("let a = 1\n## not a heading\n")
		expectSlices(text, blocks)
		expect(problems).toEqual([expect.objectContaining({ code: "unterminated_fence", line: 3 })])
	})

	test("#given closed fences only #when parsed #then problems is empty", () => {
		// given
		const text = FIXTURE
		// when
		const { problems } = parseMarkdown(text) as { problems: unknown[] }
		// then
		expect(problems).toEqual([])
	})

	const NUMBER_LINES: [string, string, string[][]][] = [
		["a year-led continuation line", "Revenue rose 12% in\n2024. Costs fell 3%.", [["paragraph", "Revenue rose 12% in\n2024. Costs fell 3%."]]],
		["a bare number at line start", "Sales grew in\n2024 revenue rose 4%.", [["paragraph", "Sales grew in\n2024 revenue rose 4%."]]],
		["a 1. marker after a paragraph", "Intro line\n1. x", [["paragraph", "Intro line"], ["list_item", "x"]]],
		["a 2) marker after a paragraph", "Intro line\n2) y", [["paragraph", "Intro line\n2) y"]]],
		["a 2) marker after a blank line", "Intro line\n\n2) y", [["paragraph", "Intro line"], ["list_item", "y"]]],
		["a later ordered item in a list", "1. x\n2. y", [["list_item", "x"], ["list_item", "y"]]],
	]
	test.each(NUMBER_LINES)("#given %s #when parsed #then no number drops out of the block text", (_label, text, expected) => {
		// given / when
		const blocks = blocksOf(text)
		// then
		expect(blocks.map((b) => [b.kind, b.text])).toEqual(expected)
		expectSlices(text, blocks)
	})

	test("#given a line that opens with an inline triple-backtick span #when parsed #then it stays a paragraph and later claims are not code", () => {
		// given
		const text = "```inline``` code at start\n\nLater 42% claim."
		// when
		const { blocks, problems } = parseMarkdown(text) as { blocks: Block[]; problems: unknown[] }
		// then
		expect(blocks.map((b) => [b.kind, b.text])).toEqual([
			["paragraph", "```inline``` code at start"],
			["paragraph", "Later 42% claim."],
		])
		expect(problems).toEqual([])
	})

	test("#given a tilde fence with an info string containing backticks #when parsed #then it is still a fence", () => {
		// given
		const text = "~~~ js `x`\nconst n = 5\n~~~\nAfter 6."
		// when
		const blocks = blocksOf(text)
		// then
		expect(blocks.map((b) => [b.kind, b.text])).toEqual([
			["code", "const n = 5"],
			["paragraph", "After 6."],
		])
	})

	test("#given a table cell ending in an escaped backslash #when parsed #then the following pipe still splits cells", () => {
		// given
		const text = "| a\\\\| b \\| c |\n| --- | --- |\n| 1 | 2 |"
		// when
		const rows = blocksOf(text).filter((b) => b.kind === "table_row")
		// then
		expect((rows[0]?.cells ?? []).map((c) => c.text)).toEqual(["a\\\\", "b \\| c"])
		expectSlices(text, rows)
	})
})

describe("sectionKindsMd", () => {
	test("#given h2 headings in English and Korean #when classified #then sources and closing kinds match gates-static", () => {
		// given
		const blocks = blocksOf(FIXTURE)
		// when
		const kinds = sectionKindsMd(blocks) as (string | null)[]
		// then
		const byHeading: Record<string, string | null | undefined> = {}
		blocks.forEach((b, i) => {
			if (b.kind === "heading") byHeading[b.text] = kinds[i]
		})
		expect(byHeading.Findings).toBeNull()
		expect(byHeading.Sources).toBe("sources")
		expect(byHeading["출처"]).toBe("sources")
		expect(byHeading.Closing).toBe("closing")
		expect(byHeading["마무리"]).toBe("closing")
		expect(kinds).toHaveLength(blocks.length)
	})

	test("#given md-lite #when its section classifier is read #then it is the gates-static export itself", () => {
		// given / when / then
		expect(typeof gatesStatic.sectionKind).toBe("function")
		expect(mdLite.sectionKind).toBe(gatesStatic.sectionKind)
		expect(typeof gatesStatic.closingTest).toBe("function")
		expect(mdLite.closingTest).toBe(gatesStatic.closingTest)
	})

	test("#given one heading set as Markdown h2s and HTML h2s #when classified #then both editions give the same kinds", () => {
		// given
		const headings = ["Findings", "Sources", "\uCD9C\uCC98", "Closing", "\uB9C8\uBB34\uB9AC", "Methodology", "Contents", "Appendix A", "Glossary", "Closing the gap: GPU prices"]
		const md = headings.map((h) => `## ${h}\n\nBody.`).join("\n\n")
		const html = `<html><body>${headings.map((h) => `<h2>${h}</h2><p>Body.</p>`).join("")}</body></html>`
		// when
		const blocks = blocksOf(md)
		const kinds = sectionKindsMd(blocks) as (string | null)[]
		const mdKinds = blocks.flatMap((b, i) => (b.kind === "heading" ? [kinds[i]] : []))
		const htmlKinds = gatesStatic.buildContext(parseHtml(html), {}).sections.map((s: { kind: string | null }) => s.kind)
		// then
		expect(mdKinds).toEqual(htmlKinds)
		expect(mdKinds).toEqual([null, "sources", "sources", "closing", "closing", "closing", "toc", "appendix", "glossary", null])
	})

	test("#given a findings heading that only starts with Closing #when classified #then it is not a closing section", () => {
		// given
		const blocks = blocksOf("## Closing the gap: GPU prices\n\nPrices fell 8%.\n\n### Closing remarks on supply\n\nSupply rose 2%.")
		// when
		const kinds = sectionKindsMd(blocks) as (string | null)[]
		// then
		expect(kinds).toEqual([null, null, null, null])
	})

	test("#given a caller closing pattern given as a string #when classified #then it is applied as in gates-static", () => {
		// given
		const blocks = blocksOf("## Wrap-up\n\nDone.")
		// when
		const kinds = sectionKindsMd(blocks, { closingPattern: "wrap-up" }) as (string | null)[]
		// then
		expect(kinds).toEqual(["closing", "closing"])
	})

	test("#given body blocks under a section #when classified #then they inherit the enclosing h2 kind", () => {
		// given
		const blocks = blocksOf(FIXTURE)
		// when
		const kinds = sectionKindsMd(blocks) as (string | null)[]
		// then
		const codeIndex = blocks.findIndex((b) => b.kind === "code")
		const sourceLine = blocks.findIndex((b) => b.text === "S1 example.org")
		expect(kinds[codeIndex]).toBeNull()
		expect(kinds[sourceLine]).toBe("sources")
		expect(kinds[0]).toBeNull()
	})
})
