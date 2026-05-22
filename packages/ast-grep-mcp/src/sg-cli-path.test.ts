import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { executableCandidates, isValidBinary } from "./sg-cli-path"

const temporaryDirectories: string[] = []

function createTemporaryDirectory(prefix: string): string {
	const directory = mkdtempSync(join(tmpdir(), prefix))
	temporaryDirectories.push(directory)
	return directory
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true })
	}
})

describe("executableCandidates", () => {
	it("adds Windows launcher extensions for extensionless ast-grep paths", () => {
		expect(executableCandidates("C:\\omo\\node_modules\\@ast-grep\\cli\\sg", "win32")).toEqual([
			"C:\\omo\\node_modules\\@ast-grep\\cli\\sg",
			"C:\\omo\\node_modules\\@ast-grep\\cli\\sg.exe",
			"C:\\omo\\node_modules\\@ast-grep\\cli\\sg.cmd",
			"C:\\omo\\node_modules\\@ast-grep\\cli\\sg.bat",
		])
	})

	it("does not duplicate an existing Windows executable extension", () => {
		expect(executableCandidates("C:\\omo\\node_modules\\@ast-grep\\cli\\sg.exe", "win32")).toEqual([
			"C:\\omo\\node_modules\\@ast-grep\\cli\\sg.exe",
		])
	})

	it("keeps non-Windows executable paths unchanged", () => {
		expect(executableCandidates("/workspace/node_modules/@ast-grep/cli/sg", "linux")).toEqual([
			"/workspace/node_modules/@ast-grep/cli/sg",
		])
	})

	it("accepts small Windows command shims as valid executables", () => {
		const directory = createTemporaryDirectory("omo-sg-cli-shim-")
		const shimPath = join(directory, "sg.cmd")
		writeFileSync(shimPath, "@echo off\r\nnode sg.js %*\r\n", "utf8")

		expect(isValidBinary(shimPath)).toBe(true)
	})

	it("rejects tiny native executable candidates", () => {
		const directory = createTemporaryDirectory("omo-sg-cli-native-")
		const exePath = join(directory, "sg.exe")
		writeFileSync(exePath, "not a binary", "utf8")

		expect(isValidBinary(exePath)).toBe(false)
	})
})
