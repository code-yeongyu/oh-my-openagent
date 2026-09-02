import { describe, expect, it } from "bun:test"

import { resolveWindowsSystemToolExistent } from "./system-tool-paths"

describe("resolveWindowsSystemToolExistent", () => {
	it("#given a valid tool under a custom SystemRoot #when resolving #then the absolute path is returned as found", () => {
		// Uses mock exists checker so the test passes identically on Linux CI and Windows
		const mockExists = (p: string) => p === "C:\\Windows\\System32\\cmd.exe"
		const result = resolveWindowsSystemToolExistent("cmd.exe", "C:\\Windows", mockExists)
		expect(result).toEqual({ found: true, path: "C:\\Windows\\System32\\cmd.exe" })
	})

	it("#given a malformed SystemRoot pointing to a nonexistent directory #when resolving #then a nonfatal miss is returned with the attempted path", () => {
		const mockExists = (_p: string) => false
		const result = resolveWindowsSystemToolExistent("taskkill.exe", "C:\\Nonexistent\\Root", mockExists)
		expect(result.found).toBe(false)
		if (!result.found) {
			expect(result.path).toBe("C:\\Nonexistent\\Root\\System32\\taskkill.exe")
		}
	})

	it("#given an empty SystemRoot string #when resolving #then the C:\\Windows fallback is attempted", () => {
		const mockExists = (p: string) => p === "C:\\Windows\\System32\\taskkill.exe"
		const result = resolveWindowsSystemToolExistent("taskkill.exe", "", mockExists)
		expect(result).toEqual({ found: true, path: "C:\\Windows\\System32\\taskkill.exe" })
	})

	it("#given no explicit root and an ambient SystemRoot absent from env #when resolving #then the C:\\Windows fallback is attempted", () => {
		const mockExists = (p: string) => p === "C:\\Windows\\System32\\where.exe"
		const result = resolveWindowsSystemToolExistent("where.exe", undefined, mockExists)
		expect(result).toEqual({ found: true, path: "C:\\Windows\\System32\\where.exe" })
	})
})
