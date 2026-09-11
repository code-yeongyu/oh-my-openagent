import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "bun:test"

import { windowsSystemTarPath, zipTarCommand } from "./windows-system-tar"

function environmentWithoutPath(pathValue: string): NodeJS.ProcessEnv {
	const entries = Object.entries(process.env).filter(
		([name]) => name.toUpperCase() !== "PATH"
	)
	return { ...Object.fromEntries(entries), PATH: pathValue }
}

describe("windows system tar", () => {
	it("#given a non-Windows platform #when the zip tar command is resolved #then it stays the bare name", () => {
		// given
		if (process.platform === "win32") {
			return
		}

		// when / then
		expect(windowsSystemTarPath()).toBeNull()
		expect(zipTarCommand()).toBe("tar")
	})

	it("#given a PATH that cannot resolve tar #when the zip tar command runs #then it is still the Windows bsdtar", () => {
		// given
		if (process.platform !== "win32") {
			return
		}
		const emptyDirectory = mkdtempSync(join(tmpdir(), "zip-tar-no-path-"))

		try {
			// when
			const version = execFileSync(zipTarCommand(), ["--version"], {
				encoding: "utf8",
				env: environmentWithoutPath(emptyDirectory),
			})

			// then
			expect(version).toContain("bsdtar")
		} finally {
			rmSync(emptyDirectory, { recursive: true, force: true })
		}
	})

	it("#given a SystemRoot without a System32 tar #when the zip tar command is resolved #then it falls back to the bare name", () => {
		// given
		if (process.platform !== "win32") {
			return
		}
		const emptyRoot = mkdtempSync(join(tmpdir(), "zip-tar-no-system32-"))

		try {
			// when / then
			expect(windowsSystemTarPath({ SystemRoot: emptyRoot })).toBeNull()
			expect(zipTarCommand({ SystemRoot: emptyRoot })).toBe("tar")
		} finally {
			rmSync(emptyRoot, { recursive: true, force: true })
		}
	})
})
