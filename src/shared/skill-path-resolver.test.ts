import { describe, it, expect } from "bun:test"
import { resolveSkillPathReferences } from "./skill-path-resolver"

describe("resolveSkillPathReferences", () => {
	it("resolves @path references containing a slash to absolute paths", () => {
		//#given
		const content = "Run `python3 @scripts/search.py` to search"
		const basePath = "/home/user/.config/opencode/skills/frontend-ui-ux"

		//#when
		const result = resolveSkillPathReferences(content, basePath)

		//#then
		expect(result).toBe(
			"Run `python3 /home/user/.config/opencode/skills/frontend-ui-ux/scripts/search.py` to search"
		)
	})

	it("resolves multiple @path references in the same content", () => {
		//#given
		const content = "Script: @scripts/search.py\nData: @data/styles.csv"
		const basePath = "/skills/frontend"

		//#when
		const result = resolveSkillPathReferences(content, basePath)

		//#then
		expect(result).toBe(
			"Script: /skills/frontend/scripts/search.py\nData: /skills/frontend/data/styles.csv"
		)
	})

	it("resolves directory references with trailing slash", () => {
		//#given
		const content = "Data files: @data/"
		const basePath = "/skills/frontend"

		//#when
		const result = resolveSkillPathReferences(content, basePath)

		//#then
		expect(result).toBe("Data files: /skills/frontend/data/")
	})

	it("does not resolve single-segment @references without slash", () => {
		//#given
		const content = "@param value @ts-ignore @path"
		const basePath = "/skills/frontend"

		//#when
		const result = resolveSkillPathReferences(content, basePath)

		//#then
		expect(result).toBe("@param value @ts-ignore @path")
	})

	it("does not resolve email addresses", () => {
		//#given
		const content = "Contact user@example.com for help"
		const basePath = "/skills/frontend"

		//#when
		const result = resolveSkillPathReferences(content, basePath)

		//#then
		expect(result).toBe("Contact user@example.com for help")
	})

	it("handles deeply nested path references", () => {
		//#given
		const content = "@data/stacks/html-tailwind.csv"
		const basePath = "/skills/frontend"

		//#when
		const result = resolveSkillPathReferences(content, basePath)

		//#then
		expect(result).toBe("/skills/frontend/data/stacks/html-tailwind.csv")
	})

	it("returns content unchanged when no @path references exist", () => {
		//#given
		const content = "No path references here"
		const basePath = "/skills/frontend"

		//#when
		const result = resolveSkillPathReferences(content, basePath)

		//#then
		expect(result).toBe("No path references here")
	})

	it("handles basePath with trailing slash", () => {
		//#given
		const content = "@scripts/search.py"
		const basePath = "/skills/frontend/"

		//#when
		const result = resolveSkillPathReferences(content, basePath)

		//#then
		expect(result).toBe("/skills/frontend/scripts/search.py")
	})
})
