// Every references/*.md must have balanced code fences: an unclosed fence renders prose as code
// and flips every later fence in the file. md-lite is the parser the skill's own tools use.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { parseMarkdown } from "./md-lite.mjs"

const REFERENCES = join(import.meta.dir, "..", "references")
const FILES = readdirSync(REFERENCES).filter((name) => name.endsWith(".md")).sort()

describe("references/*.md fence parity", () => {
	test("#given the references directory #when listed #then it holds the reference pages", () => {
		expect(FILES.length).toBeGreaterThan(0)
	})

	for (const name of FILES) {
		test(`#given ${name} #when its fences are counted #then the count is even and md-lite reports no problem`, () => {
			const text = readFileSync(join(REFERENCES, name), "utf8")
			const fences = text.split("\n").filter((line) => /^ {0,3}(`{3,}|~{3,})/u.test(line))
			expect(fences.length % 2, `${name} has ${fences.length} fence lines`).toBe(0)
			expect(parseMarkdown(text).problems).toEqual([])
		})
	}
})
