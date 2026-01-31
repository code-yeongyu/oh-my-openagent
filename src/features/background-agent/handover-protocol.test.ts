import { describe, test, expect } from "bun:test"
import { parseHandover, formatHandover, extractSection } from "./handover-protocol"

describe("handover-protocol", () => {
	describe("parseHandover", () => {
		test("should parse structured output with all sections", () => {
			// #given
			const input = `## Summary
Task completed successfully.

## Discoveries
- Found pattern A in codebase
- Identified issue B

## Questions
- Should we refactor module C?
- Need clarification on requirement D

## Suggestions
- Consider using library E
- Optimize function F`

			// #when
			const result = parseHandover(input)

			// #then
			expect(result.isStructured).toBe(true)
			expect(result.summary).toBe("Task completed successfully.")
			expect(result.discoveries).toEqual([
				"Found pattern A in codebase",
				"Identified issue B",
			])
			expect(result.questions).toEqual([
				"Should we refactor module C?",
				"Need clarification on requirement D",
			])
			expect(result.suggestions).toEqual([
				"Consider using library E",
				"Optimize function F",
			])
			expect(result.raw).toBe(input)
		})

		test("should handle missing sections with placeholders", () => {
			// #given
			const input = `## Summary
Only summary provided.`

			// #when
			const result = parseHandover(input)

			// #then
			expect(result.isStructured).toBe(true)
			expect(result.summary).toBe("Only summary provided.")
			expect(result.discoveries).toEqual([])
			expect(result.questions).toEqual([])
			expect(result.suggestions).toEqual([])
		})

		test("should extract summary from unstructured text", () => {
			// #given
			const input = `This is the first paragraph as summary.

This is second paragraph.
This is third paragraph.`

			// #when
			const result = parseHandover(input)

			// #then
			expect(result.isStructured).toBe(false)
			expect(result.summary).toBe("This is the first paragraph as summary.")
			expect(result.discoveries).toEqual([])
			expect(result.questions).toEqual([])
			expect(result.suggestions).toEqual([])
		})

		test("should support Chinese section headers", () => {
			// #given
			const input = `## 总结
任务完成。

## 发现
- 发现问题A
- 发现问题B

## 问题
- 需要确认X吗？

## 建议
- 建议使用Y`

			// #when
			const result = parseHandover(input)

			// #then
			expect(result.isStructured).toBe(true)
			expect(result.summary).toBe("任务完成。")
			expect(result.discoveries).toEqual(["发现问题A", "发现问题B"])
			expect(result.questions).toEqual(["需要确认X吗？"])
			expect(result.suggestions).toEqual(["建议使用Y"])
		})

		test("should handle empty input", () => {
			// #given
			const input = ""

			// #when
			const result = parseHandover(input)

			// #then
			expect(result.isStructured).toBe(false)
			expect(result.summary).toBe("No summary provided")
			expect(result.discoveries).toEqual([])
			expect(result.questions).toEqual([])
			expect(result.suggestions).toEqual([])
			expect(result.raw).toBe("")
		})

		test("should handle whitespace-only input", () => {
			// #given
			const input = "   \n\n  \n  "

			// #when
			const result = parseHandover(input)

			// #then
			expect(result.isStructured).toBe(false)
			expect(result.summary).toBe("No summary provided")
			expect(result.discoveries).toEqual([])
			expect(result.questions).toEqual([])
			expect(result.suggestions).toEqual([])
		})

		test("should handle mixed English and Chinese headers", () => {
			// #given
			const input = `## Summary
Mixed language test.

## 发现
- Discovery in Chinese section

## Questions
- Question in English

## 建议
- Suggestion in Chinese`

			// #when
			const result = parseHandover(input)

			// #then
			expect(result.isStructured).toBe(true)
			expect(result.summary).toBe("Mixed language test.")
			expect(result.discoveries).toEqual(["Discovery in Chinese section"])
			expect(result.questions).toEqual(["Question in English"])
			expect(result.suggestions).toEqual(["Suggestion in Chinese"])
		})

		test("should handle sections without list items", () => {
			// #given
			const input = `## Summary
Summary text here.

## Discoveries
No discoveries found.

## Questions
No questions.

## Suggestions
No suggestions.`

			// #when
			const result = parseHandover(input)

			// #then
			expect(result.isStructured).toBe(true)
			expect(result.summary).toBe("Summary text here.")
			expect(result.discoveries).toEqual([])
			expect(result.questions).toEqual([])
			expect(result.suggestions).toEqual([])
		})

		test("should handle bullet points with different markers", () => {
			// #given
			const input = `## Summary
Test summary.

## Discoveries
- Dash item
* Asterisk item
+ Plus item

## Questions
- Question 1
* Question 2

## Suggestions
- Suggestion 1`

			// #when
			const result = parseHandover(input)

			// #then
			expect(result.isStructured).toBe(true)
			expect(result.discoveries).toEqual([
				"Dash item",
				"Asterisk item",
				"Plus item",
			])
			expect(result.questions).toEqual(["Question 1", "Question 2"])
			expect(result.suggestions).toEqual(["Suggestion 1"])
		})
	})

	describe("formatHandover", () => {
		test("should produce valid structured output", () => {
			// #given
			const result = {
				summary: "Task completed",
				discoveries: ["Discovery A", "Discovery B"],
				questions: ["Question A"],
				suggestions: ["Suggestion A", "Suggestion B"],
				raw: "",
				isStructured: true,
			}

			// #when
			const formatted = formatHandover(result)

			// #then
			expect(formatted).toContain("## Summary")
			expect(formatted).toContain("Task completed")
			expect(formatted).toContain("## Discoveries")
			expect(formatted).toContain("- Discovery A")
			expect(formatted).toContain("- Discovery B")
			expect(formatted).toContain("## Questions")
			expect(formatted).toContain("- Question A")
			expect(formatted).toContain("## Suggestions")
			expect(formatted).toContain("- Suggestion A")
			expect(formatted).toContain("- Suggestion B")
		})

		test("should handle empty arrays", () => {
			// #given
			const result = {
				summary: "Only summary",
				discoveries: [],
				questions: [],
				suggestions: [],
				raw: "",
				isStructured: true,
			}

			// #when
			const formatted = formatHandover(result)

			// #then
			expect(formatted).toContain("## Summary")
			expect(formatted).toContain("Only summary")
			expect(formatted).toContain("## Discoveries")
			expect(formatted).toContain("## Questions")
			expect(formatted).toContain("## Suggestions")
		})

		test("should roundtrip parse and format", () => {
			// #given
			const original = `## Summary
Test summary.

## Discoveries
- Item 1
- Item 2

## Questions
- Q1

## Suggestions
- S1`

			// #when
			const parsed = parseHandover(original)
			const formatted = formatHandover(parsed)
			const reparsed = parseHandover(formatted)

			// #then
			expect(reparsed.summary).toBe(parsed.summary)
			expect(reparsed.discoveries).toEqual(parsed.discoveries)
			expect(reparsed.questions).toEqual(parsed.questions)
			expect(reparsed.suggestions).toEqual(parsed.suggestions)
		})
	})

	describe("extractSection", () => {
		test("should find section by header", () => {
			// #given
			const text = `## Summary
Summary text here.

## Discoveries
Discovery text here.

## Questions
Questions text here.`

			// #when
			const summary = extractSection(text, "Summary")
			const discoveries = extractSection(text, "Discoveries")
			const questions = extractSection(text, "Questions")

			// #then
			expect(summary).toContain("Summary text here.")
			expect(discoveries).toContain("Discovery text here.")
			expect(questions).toContain("Questions text here.")
		})

		test("should return null for missing section", () => {
			// #given
			const text = `## Summary
Summary only.`

			// #when
			const result = extractSection(text, "Discoveries")

			// #then
			expect(result).toBeNull()
		})

		test("should support Chinese headers", () => {
			// #given
			const text = `## 总结
总结内容。

## 发现
发现内容。`

			// #when
			const summary = extractSection(text, "总结")
			const discoveries = extractSection(text, "发现")

			// #then
			expect(summary).toContain("总结内容。")
			expect(discoveries).toContain("发现内容。")
		})

		test("should handle section at end of text", () => {
			// #given
			const text = `## Summary
First section.

## Suggestions
Last section content.`

			// #when
			const result = extractSection(text, "Suggestions")

			// #then
			expect(result).toContain("Last section content.")
		})

		test("should handle case-insensitive matching", () => {
			// #given
			const text = `## summary
Lower case header.

## DISCOVERIES
Upper case header.`

			// #when
			const summary = extractSection(text, "Summary")
			const discoveries = extractSection(text, "Discoveries")

			// #then
			expect(summary).toContain("Lower case header.")
			expect(discoveries).toContain("Upper case header.")
		})
	})
})
