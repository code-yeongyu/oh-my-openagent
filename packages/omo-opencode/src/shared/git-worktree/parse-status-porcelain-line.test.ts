/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { parseGitStatusPorcelainLine } from "./parse-status-porcelain-line"

describe("parseGitStatusPorcelainLine", () => {
	test("#given modified porcelain line #when parsing #then returns modified status", () => {
		//#given
		const line = " M src/a.ts"

		//#when
		const result = parseGitStatusPorcelainLine(line)

		//#then
		expect(result).toEqual({ filePath: "src/a.ts", status: "modified" })
	})

	test("#given added porcelain line #when parsing #then returns added status", () => {
		//#given
		const line = "A  src/b.ts"

		//#when
		const result = parseGitStatusPorcelainLine(line)

		//#then
		expect(result).toEqual({ filePath: "src/b.ts", status: "added" })
	})

	test("#given untracked porcelain line #when parsing #then returns added status", () => {
		//#given
		const line = "?? src/c.ts"

		//#when
		const result = parseGitStatusPorcelainLine(line)

		//#then
		expect(result).toEqual({ filePath: "src/c.ts", status: "added" })
	})

	test("#given deleted porcelain line #when parsing #then returns deleted status", () => {
		//#given
		const line = "D  src/d.ts"

		//#when
		const result = parseGitStatusPorcelainLine(line)

		//#then
		expect(result).toEqual({ filePath: "src/d.ts", status: "deleted" })
	})

	test("#given empty line #when parsing #then returns null", () => {
		//#given
		const line = ""

		//#when
		const result = parseGitStatusPorcelainLine(line)

		//#then
		expect(result).toBeNull()
	})

	test("#given malformed line without path #when parsing #then returns null", () => {
		//#given
		const line = " M "

		//#when
		const result = parseGitStatusPorcelainLine(line)

		//#then
		expect(result).toBeNull()
	})
})
