import { describe, expect, it } from "bun:test"

import { resolveWindowsSystemToolExistent } from "./system-tool-paths"

// Real-surface win32 cases demanded by the PR #6740 review: a missing/malformed
// SystemRoot and a forced missing executable must degrade gracefully —
// execFile's callback receives the error instead of the process dying on an
// unhandled spawn error event (issue #6738).
describe.skipIf(process.platform !== "win32")("resolveWindowsSystemToolExistent win32 real-surface", () => {
	it("#given a forced missing executable #when resolving with the real existsSync #then a nonfatal miss is returned without throwing", () => {
		const result = resolveWindowsSystemToolExistent("definitely-not-a-real-tool.exe")
		expect(result.found).toBe(false)
		if (!result.found) {
			expect(result.path).toMatch(/definitely-not-a-real-tool\.exe$/)
		}
	})

	it("#given a malformed SystemRoot #when the resolved path is fed to execFile #then the callback receives the error and no uncaught exception escapes", async () => {
		const { execFile } = await import("node:child_process")
		const { path } = resolveWindowsSystemToolExistent("taskkill.exe", "C:\\Malformed\\Root\\Does\\Not\\Exist")
		const outcome = await new Promise<{ errored: boolean; code?: string }>((resolvePromise) => {
			execFile(path, ["/PID", "999999999", "/T"], { timeout: 10_000, windowsHide: true }, (error) => {
				resolvePromise({
					errored: error !== null,
					code: error !== null && "code" in error ? String(error.code) : undefined,
				})
			})
		})
		expect(outcome.errored).toBe(true)
		expect(outcome.code).toBe("ENOENT")
	})

	it("#given the real SystemRoot #when resolving taskkill #then the executable exists and a spawn against a dead PID fails closed", async () => {
		const { execFile } = await import("node:child_process")
		const resolved = resolveWindowsSystemToolExistent("taskkill.exe", process.env["SystemRoot"])
		expect(resolved.found).toBe(true)
		if (!resolved.found) return
		const outcome = await new Promise<{ errored: boolean }>((resolvePromise) => {
			execFile(resolved.path, ["/PID", "999999999", "/T"], { timeout: 10_000, windowsHide: true }, (error) => {
				resolvePromise({ errored: error !== null })
			})
		})
		expect(outcome.errored).toBe(true)
	})
})