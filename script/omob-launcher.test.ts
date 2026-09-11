import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join, resolve } from "node:path"
import { writeTestExecutable } from "./omob-test-executable"
import * as builder from "./build-omob"

describe("omob mainline launcher", () => {
	test("#given ordinary installation #when defaults are parsed #then the managed launcher is retained", () => {
		expect(builder.parseOmobArgs([], "darwin", "arm64", "/home/dev").launcher).toBe(true)
	})

	test("#given mainline refresh flags #when parsed #then startup refresh is supported", () => {
		expect(() => builder.parseOmobArgs(["--if-changed", "--launcher"], "darwin", "arm64", "/home/dev")).not.toThrow()
	})

	test.skipIf(process.platform === "win32")("#given explicit feature refs #when building directly #then only explicit launcher installation rejects them", () => {
		const args = ["--omo-ref", "origin/feature", "--senpi-ref", "origin/experiment"]
		const feature = builder.parseOmobArgs([...args, "--name", "omob-feature"], "darwin", "arm64", "/home/dev")
		expect(feature.omoRef).toBe("origin/feature")
		expect(feature.cacheDir).toBe(resolve("/home/dev", ".cache", "omob-feature"))
		expect(() => builder.parseOmobArgs(args, "darwin", "arm64", "/home/dev")).toThrow()
		expect(() => builder.parseOmobArgs([...args, "--launcher"], "darwin", "arm64", "/home/dev")).toThrow()
		expect(builder.parseOmobArgs([], "darwin", "arm64", "/home/dev").omoRef).toBe("origin/dev")
	})

	test("#given an incompletely written cache claim #when another updater starts #then it cannot steal the lock", () => {
		const root = mkdtempSync(join(tmpdir(), "omob-lock-incomplete-"))
		try {
			writeFileSync(join(root, ".lock"), "")
			expect(() => builder.acquireCacheLock(root)).toThrow()
		} finally { rmSync(root, { recursive: true, force: true }) }
	})

	for (const changed of [false, true]) {
		test(`#given a ${changed ? "changed" : "same"} SHA pair #when cache is checked #then rebuild is ${changed}`, () => {
			const root = mkdtempSync(join(tmpdir(), "omob-pair-"))
			try {
				const current = builder.isCurrentOmobBuild
				expect(typeof current).toBe("function")
				const binary = join(root, process.platform === "win32" ? "omob.exe" : "omob")
				const info = { command: "omob", omo: { commit: "a".repeat(40), committedAt: "2026-09-09T00:00:00Z", branch: "dev" }, engine: { commit: "b".repeat(40), committedAt: "2026-09-09T00:00:00Z", branch: "main" } }
				writeTestExecutable(binary, `console.log(${JSON.stringify(`omob dev build\nomo   ${info.omo.commit} ${info.omo.committedAt} (dev)\nsenpi ${info.engine.commit} ${info.engine.committedAt} (main)`)})`)
				const requested = changed ? { ...info, engine: { ...info.engine, commit: "c".repeat(40) } } : info
				writeFileSync(`${binary}.build.json`, JSON.stringify({ buildInfo: requested }))
				expect(current(binary, requested, builder.hostTargetFor(process.platform, process.arch))).toBe(!changed)
				rmSync(binary)
				expect(current(binary, requested, builder.hostTargetFor(process.platform, process.arch))).toBe(false)
			} finally { rmSync(root, { recursive: true, force: true }) }
		})
	}

	test.skipIf(process.platform === "win32")(`#given a signaled executable #when launched #then the launcher preserves the signal`, () => {
		const root = mkdtempSync(join(tmpdir(), "omob-signal-"))
		try {
			const options = builder.parseOmobArgs(["--cache-dir", join(root, "cache"), "--install-dir", join(root, "bin")], "darwin", "arm64", root)
			if (process.platform === "win32") {
				expect(() => builder.installOmobLauncher(options)).toThrow(/POSIX shell/)
				expect(existsSync(options.installDir)).toBe(false)
				return
			}
			const tools = join(root, "tools")
			mkdirSync(tools)
			mkdirSync(join(options.cacheDir, "bin"), { recursive: true })
			writeFileSync(join(tools, "bun"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
			writeFileSync(join(options.cacheDir, "bin", "omob"), "#!/bin/sh\nkill -TERM $$\n", { mode: 0o755 })
			builder.installOmobLauncher(options)
			const result = spawnSync(join(options.installDir, "omob"), [], { env: { ...process.env, PATH: `${tools}${delimiter}${process.env.PATH}` } })
			expect(result.signal).toBe("SIGTERM")
			expect(result.status).toBeNull()
		} finally { rmSync(root, { recursive: true, force: true }) }
	})

	for (const fail of [false, true]) {
		test.skipIf(process.platform === "win32")(`#given ${fail ? "failed" : "successful"} refresh #when launched #then ${fail ? "the previous binary survives without launching" : "args and exit status reach the refreshed executable"}`, () => {
			const root = mkdtempSync(join(tmpdir(), "omob-launcher-"))
			try {
				const install = builder.installOmobLauncher
				expect(typeof install).toBe("function")
				const options = builder.parseOmobArgs(["--cache-dir", join(root, "cache space"), "--install-dir", join(root, "bin")], "darwin", "arm64", root)
				const fakeBin = join(root, "tools")
				mkdirSync(fakeBin)
				const binaryDir = join(options.cacheDir, "bin")
				mkdirSync(binaryDir, { recursive: true })
				const binary = join(binaryDir, "omob")
				const previous = '#!/bin/sh\nprintf "stale launched\\n"\n'
				writeFileSync(binary, previous, { mode: 0o755 })
				const receipt = join(root, "refresh-args")
				writeFileSync(join(fakeBin, "bun"), `#!/bin/sh\nprintf '%s\\n' "$@" > '${receipt}'\n${fail ? "exit 29" : `printf '%s\\n' '#!/bin/sh' 'printf "<%s>\\n" "$@"' 'exit 37' > '${binary}'` }\n`, { mode: 0o755 })
				if (process.platform === "win32") {
					expect(() => install(options)).toThrow(/POSIX shell/)
					expect(existsSync(options.installDir)).toBe(false)
					expect(existsSync(receipt)).toBe(false)
					expect(readFileSync(binary, "utf8")).toBe(previous)
					return
				}
				install(options)
				const result = spawnSync(join(options.installDir, options.name), ["a b", "", "--flag", "$(echo unsafe)"], { encoding: "utf8", env: { ...process.env, PATH: `${fakeBin}${delimiter}${process.env.PATH}` } })
				expect(result.status).toBe(fail ? 29 : 37)
				expect(result.stdout).toBe(fail ? "" : "<a b>\n<>\n<--flag>\n<$(echo unsafe)>\n")
				expect(readFileSync(receipt, "utf8").split("\n")).toContain("--if-changed")
				if (fail) expect(readFileSync(binary, "utf8")).toBe(previous)
			} finally {
				rmSync(root, { recursive: true, force: true })
			}
		})
	}
})
