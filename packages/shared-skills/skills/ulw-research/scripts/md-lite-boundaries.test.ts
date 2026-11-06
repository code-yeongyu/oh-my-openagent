import { describe, expect, test } from "bun:test"

import { parseMarkdown } from "./md-lite.mjs"
import { parseNumeral } from "./numerals.mjs"

describe("Markdown list continuation boundaries", () => {
	test("#given a continuation after a list item #when parsed #then a later marker stays paragraph text", () => {
		const text = "1. a\ncontinued\n2. b"
		const { blocks } = parseMarkdown(text)
		expect(blocks.map((block: { kind: string; text: string }) => [block.kind, block.text])).toEqual([
			["list_item", "a"],
			["paragraph", "continued\n2. b"],
		])
	})

	test("#given numbers beside a list continuation #when parsed #then fidelity numerals retain source offsets", () => {
		const text = "1. a 12%\ncontinued\n2. b 34%"
		const { blocks } = parseMarkdown(text)
		const found = blocks.flatMap((block: { text: string; start: number }) => {
			const numerals = []
			for (let numeral = parseNumeral(block.text); numeral; numeral = parseNumeral(block.text, numeral.span[1])) {
				const [start, end] = numeral.span
				numerals.push([numeral.value, text.slice(block.start + start, block.start + end)])
			}
			return numerals
		})
		expect(found).toEqual([["12", "12%"], ["2", "2"], ["34", "34%"]])
	})
})

describe("Markdown closing fence indentation", () => {
	test.each(["```", "~~~"])("#given a four-space %s closing candidate #when parsed #then the code runs to EOF", (fence: string) => {
		const text = `${fence}\ncode 12\n    ${fence}\nclaim 34`
		const { blocks, problems } = parseMarkdown(text)
		expect(blocks.map((block: { kind: string; text: string }) => [block.kind, block.text])).toEqual([
			["code", `code 12\n    ${fence}\nclaim 34`],
		])
		expect(problems).toEqual([{ code: "unterminated_fence", line: 1, start: 0 }])
	})

	test.each([0, 1, 2, 3])("#given a closing fence indented %s spaces #when parsed #then later prose is outside code", (spaces: number) => {
		const { blocks, problems } = parseMarkdown(`\`\`\`\ncode\n${" ".repeat(spaces)}\`\`\`\nclaim 34`)
		expect(blocks.map((block: { kind: string }) => block.kind)).toEqual(["code", "paragraph"])
		expect(problems).toEqual([])
	})
})
