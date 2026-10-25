import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { checkTui } from "./tui-grid"

const skill = readFileSync(join(import.meta.dir, "..", "SKILL.md"), "utf-8")
const emitted = new Set(Object.keys(checkTui("abc", 10)))

function fieldNames(line: string): string[] {
	return [...line.matchAll(/`([A-Za-z]+)(?:\[\])?`|\b([a-z]+[A-Z][A-Za-z]*)(?:\[\])?/g)].map((m) => m[1] ?? m[2] ?? "")
}

function lineStartingWith(prefix: string, after = ""): string {
	const lines = skill.split("\n")
	const from = after === "" ? 0 : lines.findIndex((l) => l.includes(after))
	if (from < 0) throw new Error(`SKILL.md has no line containing ${after}`)
	const line = lines.slice(from).find((l) => l.trimStart().startsWith(prefix))
	if (line === undefined) throw new Error(`SKILL.md has no line starting with ${prefix} after ${after}`)
	return line
}

describe("tool-output contract: the tui-check JSON fields visual-qa SKILL.md tells reviewers to read", () => {
	const keyFields = fieldNames(lineStartingWith("Key fields:", 'visual-qa.mjs" tui-check'))
	const passBInspects = fieldNames(lineStartingWith("- TUI (tui-check):"))

	test("#given the Key fields line #when compared with checkTui output #then every listed field is emitted", () => {
		expect(keyFields.filter((name) => !emitted.has(name))).toEqual([])
	})

	test("#given Pass B's tui-check instructions #when compared with the Key fields line #then every inspected field is listed", () => {
		expect(passBInspects.length).toBeGreaterThan(0)
		expect(passBInspects.filter((name) => !keyFields.includes(name))).toEqual([])
	})
})
