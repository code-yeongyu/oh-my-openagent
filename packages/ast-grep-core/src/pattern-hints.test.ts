import { describe, test, expect } from "bun:test"
import { detectRegexMisuse, detectLanguageSpecificMistake, getPatternHint } from "./pattern-hints"

describe("pattern-hints", () => {
	describe("#given detectRegexMisuse", () => {
		describe("#when pattern contains regex escape sequences", () => {
			test("#then returns hint for \\w", () => {
				const result = detectRegexMisuse("\\w+")
				expect(result).toContain("\\w")
				expect(result).toContain("ast-grep matches AST nodes")
			})

			test("#then returns hint for \\d", () => {
				const result = detectRegexMisuse("\\d{3}")
				expect(result).toContain("regex escapes")
			})

			test("#then returns hint for \\s", () => {
				const result = detectRegexMisuse("foo\\sbar")
				expect(result).toContain("regex escapes")
			})

			test("#then returns hint for \\b", () => {
				const result = detectRegexMisuse("\\bword\\b")
				expect(result).toContain("regex escapes")
			})
		})

		describe("#when pattern contains character classes", () => {
			test("#then returns hint for [a-z]", () => {
				const result = detectRegexMisuse("[a-z]+")
				expect(result).toContain("character classes")
			})

			test("#then returns hint for [A-Z]", () => {
				const result = detectRegexMisuse("[A-Z]foo")
				expect(result).toContain("character classes")
			})

			test("#then returns hint for [0-9]", () => {
				const result = detectRegexMisuse("[0-9]")
				expect(result).toContain("character classes")
			})
		})

		describe("#when pattern contains .* or .+ wildcards", () => {
			test("#then returns hint for .*", () => {
				const result = detectRegexMisuse("foo.*bar")
				expect(result).toContain(".*")
				expect(result).toContain("regex wildcards")
			})

			test("#then returns hint for .+", () => {
				const result = detectRegexMisuse("foo.+bar")
				expect(result).toContain(".+")
			})

			test("#then does NOT trigger when pattern contains $VAR", () => {
				// patterns with $ are valid ast-grep meta-variables
				const result = detectRegexMisuse("$VAR.*something")
				expect(result).toBeNull()
			})
		})

		describe("#when pattern contains | alternation", () => {
			test("#then returns hint for simple alternation", () => {
				const result = detectRegexMisuse("foo|bar")
				expect(result).toContain("|")
				expect(result).toContain("alternation")
			})

			test("#then returns hint for multi-alternation", () => {
				const result = detectRegexMisuse("foo|bar|baz")
				expect(result).toContain("alternation")
			})
		})

		describe("#when pattern is valid ast-grep", () => {
			test("#then returns null for $VAR pattern", () => {
				expect(detectRegexMisuse("$VAR")).toBeNull()
			})

			test("#then returns null for function pattern", () => {
				expect(detectRegexMisuse("function $NAME($$$) { $$$ }")).toBeNull()
			})

			test("#then returns null for empty string", () => {
				expect(detectRegexMisuse("")).toBeNull()
			})

			test("#then returns null for whitespace-only", () => {
				expect(detectRegexMisuse("   ")).toBeNull()
			})

			test("#then returns null for console.log($MSG)", () => {
				expect(detectRegexMisuse("console.log($MSG)")).toBeNull()
			})
		})
	})

	describe("#given detectLanguageSpecificMistake", () => {
		describe("#when language is python", () => {
			test("#then detects trailing colon on class", () => {
				const result = detectLanguageSpecificMistake("class $C($$$):", "python")
				expect(result).toContain("Remove trailing colon")
			})

			test("#then detects trailing colon on def", () => {
				const result = detectLanguageSpecificMistake("def $FUNC($$$):", "python")
				expect(result).toContain("Remove trailing colon")
			})

			test("#then detects trailing colon on async def", () => {
				const result = detectLanguageSpecificMistake("async def $FUNC($$$):", "python")
				expect(result).toContain("Remove trailing colon")
			})

			test("#then returns null for valid python pattern without colon", () => {
				expect(detectLanguageSpecificMistake("def $FUNC($$$)", "python")).toBeNull()
			})

			test("#then returns null for class without colon", () => {
				expect(detectLanguageSpecificMistake("class $C($$$)", "python")).toBeNull()
			})
		})

		describe("#when language is javascript or typescript", () => {
			test("#then detects function without body in javascript", () => {
				const result = detectLanguageSpecificMistake("function $NAME", "javascript")
				expect(result).toContain("Function patterns need params and body")
			})

			test("#then detects function without body in typescript", () => {
				const result = detectLanguageSpecificMistake("function $NAME", "typescript")
				expect(result).toContain("Function patterns need params and body")
			})

			test("#then detects export async function without body in tsx", () => {
				const result = detectLanguageSpecificMistake("export async function $NAME", "tsx")
				expect(result).toContain("Function patterns need params and body")
			})

			test("#then returns null for complete function pattern", () => {
				expect(detectLanguageSpecificMistake("function $NAME($$$) { $$$ }", "typescript")).toBeNull()
			})
		})

		describe("#when language is go", () => {
			test("#then detects func without body", () => {
				const result = detectLanguageSpecificMistake("func $NAME", "go")
				expect(result).toContain("Go function patterns need params and body")
			})

			test("#then returns null for complete go func pattern", () => {
				expect(detectLanguageSpecificMistake("func $NAME($$$) { $$$ }", "go")).toBeNull()
			})
		})

		describe("#when language is rust", () => {
			test("#then detects fn without body", () => {
				const result = detectLanguageSpecificMistake("fn $NAME", "rust")
				expect(result).toContain("Rust fn patterns need params and body")
			})

			test("#then returns null for complete rust fn pattern", () => {
				expect(detectLanguageSpecificMistake("fn $NAME($$$) { $$$ }", "rust")).toBeNull()
			})
		})

		describe("#when pattern is empty or whitespace", () => {
			test("#then returns null for empty string", () => {
				expect(detectLanguageSpecificMistake("", "python")).toBeNull()
			})

			test("#then returns null for whitespace-only", () => {
				expect(detectLanguageSpecificMistake("   ", "typescript")).toBeNull()
			})
		})
	})

	describe("#given getPatternHint", () => {
		describe("#when pattern has regex misuse", () => {
			test("#then returns regex hint first even if language-specific also applies", () => {
				// \\w is regex misuse - should be returned first
				const result = getPatternHint("\\w+", "python")
				expect(result).toContain("regex escapes")
			})
		})

		describe("#when pattern has only language-specific mistake", () => {
			test("#then returns language-specific hint", () => {
				const result = getPatternHint("class MyClass:", "python")
				expect(result).toContain("Remove trailing colon")
			})

			test("#then returns function hint for typescript", () => {
				const result = getPatternHint("function $NAME", "typescript")
				expect(result).toContain("Function patterns need params and body")
			})
		})

		describe("#when pattern is valid", () => {
			test("#then returns null for valid ast-grep pattern", () => {
				expect(getPatternHint("console.log($$$)", "javascript")).toBeNull()
			})

			test("#then returns null for valid python pattern", () => {
				expect(getPatternHint("def $FUNC($$$)", "python")).toBeNull()
			})

			test("#then returns null for empty pattern", () => {
				expect(getPatternHint("", "typescript")).toBeNull()
			})
		})
	})
})
