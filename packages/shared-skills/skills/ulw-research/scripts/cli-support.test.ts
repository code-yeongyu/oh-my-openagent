import { describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { CliError, exitCodeFor, parseArgs, readJsonFile, writeJsonAtomic } from "./cli-support.mjs"
import { isCliEntry } from "./entry-guard.mjs"

function tempDir() {
	return mkdtempSync(join(tmpdir(), "report-tools-"))
}

describe("parseArgs", () => {
	test("#given spaced, equals, repeated, and boolean flags #when parsed #then positionals and flag values are separated", () => {
		// given
		const argv = ["a.html", "--design-spec", "spec.md", "--max-defects=5", "--require-section", "^Methods", "--require-section", "^Sources", "--json", "b"]
		// when
		const parsed = parseArgs(argv, { repeatable: ["require-section"], booleans: ["json"] })
		// then
		expect(parsed.positionals).toEqual(["a.html", "b"])
		expect(parsed.flags["design-spec"]).toBe("spec.md")
		expect(parsed.flags["max-defects"]).toBe("5")
		expect(parsed.flags["require-section"]).toEqual(["^Methods", "^Sources"])
		expect(parsed.flags.json).toBe(true)
	})

	test("#given a value flag with no value #when parsed #then a CliError names the flag", () => {
		expect(() => parseArgs(["--design-spec"], {})).toThrow(CliError)
		expect(() => parseArgs(["--design-spec"], {})).toThrow("--design-spec")
	})

	test("#given an integer flag helper #when the value is not a positive integer #then a CliError is thrown", () => {
		const parsed = parseArgs(["--cap", "0"], {})
		expect(() => parsed.int("cap")).toThrow(CliError)
		expect(parseArgs(["--cap", "7"], {}).int("cap")).toBe(7)
		expect(parseArgs([], {}).int("cap", 400)).toBe(400)
	})
})

describe("exitCodeFor", () => {
	test("#given results and errors #when mapped #then pass is 0, semantic failure is 1, usage and IO errors are 2", () => {
		expect(exitCodeFor({ exitCode: 0 })).toBe(0)
		expect(exitCodeFor({ exitCode: 1 })).toBe(1)
		expect(exitCodeFor(new CliError("usage"))).toBe(2)
		const io = Object.assign(new Error("ENOENT"), { code: "ENOENT" })
		expect(exitCodeFor(io)).toBe(2)
	})
})

describe("JSON files", () => {
	test("#given an existing file #when written atomically #then the new content replaces it and no temp file is left", () => {
		// given
		const dir = tempDir()
		const file = join(dir, "state.json")
		writeFileSync(file, '{"old":true}')
		// when
		writeJsonAtomic(file, { fresh: 1 })
		// then
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ fresh: 1 })
		expect(readJsonFile(file)).toEqual({ fresh: 1 })
		const leftovers = readdirSync(dir).filter((name) => name !== "state.json")
		expect(leftovers).toEqual([])
	})

	test("#given a missing or malformed file #when read #then a CliError names the path", () => {
		const dir = tempDir()
		expect(() => readJsonFile(join(dir, "missing.json"))).toThrow(CliError)
		const bad = join(dir, "bad.json")
		writeFileSync(bad, "{nope")
		expect(() => readJsonFile(bad)).toThrow("bad.json")
	})
})

describe("isCliEntry", () => {
	test("#given argv[1] pointing at this module #when checked #then it is an entry, and another path is not", () => {
		const original = process.argv[1]
		try {
			const self = join(import.meta.dir, "entry-guard.mjs")
			process.argv[1] = self
			expect(isCliEntry(pathToFileURL(self).href)).toBe(true)
			process.argv[1] = join(import.meta.dir, "contracts.mjs")
			expect(isCliEntry(pathToFileURL(self).href)).toBe(false)
		} finally {
			process.argv[1] = original
		}
	})
})
