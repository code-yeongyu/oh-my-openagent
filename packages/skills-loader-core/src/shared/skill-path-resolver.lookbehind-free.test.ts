import { describe, it, expect } from "bun:test"
import { resolveSkillPathReferences } from "./skill-path-resolver"

// The lookbehind form this resolver used before local fix 47; kept here only as the reference result.
function referenceMatches(content: string): string {
	const marker: string[] = []
	content.replace(/(?<![a-zA-Z0-9="\(])@([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.\-\/]*)/g, (match: string, path: string, offset: number) => {
		marker.push(`${offset}:${path}`)
		return match
	})
	return marker.join("|")
}

describe("resolveSkillPathReferences without lookbehind (local fix 47)", () => {
	const basePath = "/skills/frontend"

	it("#given a reference preceded by a word, quote, equals or paren #when resolving #then leaves it unchanged", () => {
		for (const prefix of ["x", "Z", "7", "=", "\"", "("]) {
			const content = `see ${prefix}@scripts/run.py now`
			expect(resolveSkillPathReferences(content, basePath)).toBe(content)
		}
	})

	it("#given a reference at the start, after a space, backtick or newline #when resolving #then resolves it", () => {
		expect(resolveSkillPathReferences("@scripts/run.py", basePath)).toBe("/skills/frontend/scripts/run.py")
		expect(resolveSkillPathReferences("run `@scripts/run.py`", basePath)).toBe("run `/skills/frontend/scripts/run.py`")
		expect(resolveSkillPathReferences("a\n@data/x.csv", basePath)).toBe("a\n/skills/frontend/data/x.csv")
	})

	it("#given content without @ #when resolving #then returns the same string", () => {
		const content = "plain skill body with no references"
		expect(resolveSkillPathReferences(content, basePath)).toBe(content)
	})

	it("#given a blocked reference followed by a valid one #when resolving #then only the valid one resolves", () => {
		expect(resolveSkillPathReferences("user@host/a.md and @docs/b.md", basePath)).toBe("user@host/a.md and /skills/frontend/docs/b.md")
	})

	it("#given mixed samples #when comparing with the lookbehind form #then the same references are rewritten", () => {
		const samples = [
			"email me@example.com/x.md or @scripts/a.py",
			"(@a/b.md) [@c/d.md] =@e/f.md \"@g/h.md\" '@i/j.md'",
			"@@x/y.md and @@@z/w.md",
			"npm i @scope/pkg and see @refs/guide.md",
		]
		for (const sample of samples) {
			const expected = referenceMatches(sample)
			const ours: string[] = []
			sample.replace(/@([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.\-\/]*)/g, (match: string, path: string, offset: number) => {
				if (!(offset > 0 && /[a-zA-Z0-9="(]/.test(sample.charAt(offset - 1)))) ours.push(`${offset}:${path}`)
				return match
			})
			expect(ours.join("|")).toBe(expected)
		}
	})
})
