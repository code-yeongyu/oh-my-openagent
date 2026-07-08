import { describe, it, expect } from "bun:test"
import { resolveSkillPathReferences } from "./skill-path-resolver"

describe("resolveSkillPathReferences", () => {
	it("resolves path references before trailing sentence punctuation", () => {
		//#given
		const content = "Run @scripts/search.py."
		const basePath = "/skills/frontend"

		//#when
		const result = resolveSkillPathReferences(content, basePath)

		//#then
		expect(result).toBe("Run /skills/frontend/scripts/search.py.")
	})

	it("preserves punctuation after multiple path replacements", () => {
		//#given
		const content = "Script: @scripts/search.py. Data: @data/styles.csv;"
		const basePath = "/skills/frontend"

		//#when
		const result = resolveSkillPathReferences(content, basePath)

		//#then
		expect(result).toBe(
			"Script: /skills/frontend/scripts/search.py. Data: /skills/frontend/data/styles.csv;"
		)
	})
})
