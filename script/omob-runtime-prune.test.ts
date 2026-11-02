// Contract tests for script/omob-runtime-prune.ts.

import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { listProcessCommands, planRuntimePrune, pruneOmobRuntimes, runtimesInUse, selectPruneEntries } from "./omob-runtime-prune"

describe("selectPruneEntries", () => {
	const entries = [
		{ name: "0.0.0-omob.aaaaaaa.bbbbbbb", mtimeMs: 3 },
		{ name: "0.0.0-omob.ccccccc.ddddddd", mtimeMs: 1 },
		{ name: "0.0.0-omob.eeeeeee.fffffff", mtimeMs: 2 },
		{ name: "5.0.0-0.beta.39", mtimeMs: 0 },
		{ name: "0.0.0-omob.1111111.2222222", mtimeMs: 5 },
	]

	test("keeps the newest dev runtimes and never touches release runtimes", () => {
		expect(selectPruneEntries(entries, 2)).toEqual(["0.0.0-omob.ccccccc.ddddddd", "0.0.0-omob.eeeeeee.fffffff"])
	})

	test("keeps everything below the budget", () => {
		expect(selectPruneEntries(entries, 3)).toEqual(["0.0.0-omob.ccccccc.ddddddd"])
		expect(selectPruneEntries(entries, 4)).toEqual([])
	})
})

describe("planRuntimePrune", () => {
	const entries = [
		{ name: "0.0.0-omob.cur0000.cur0000", mtimeMs: 5 },
		{ name: "0.0.0-omob.aaaaaaa.bbbbbbb", mtimeMs: 3 },
		{ name: "0.0.0-omob.ccccccc.ddddddd", mtimeMs: 1 },
		{ name: "0.0.0-omob.eeeeeee.fffffff", mtimeMs: 2 },
		{ name: "5.0.0-0.beta.40", mtimeMs: 0 },
	]
	const current = "0.0.0-omob.cur0000.cur0000"

	test("reserves a slot for the version being built and prunes the rest oldest-first", () => {
		expect(planRuntimePrune(entries, 2, current)).toEqual(["0.0.0-omob.ccccccc.ddddddd", "0.0.0-omob.eeeeeee.fffffff"])
	})

	test("never counts the current version against the budget even when its dir is absent", () => {
		const withoutCurrent = entries.filter((entry) => !entry.name.includes("cur0000"))
		expect(planRuntimePrune(withoutCurrent, 2, current)).toEqual(["0.0.0-omob.ccccccc.ddddddd", "0.0.0-omob.eeeeeee.fffffff"])
	})

	test("keep=1 leaves only the version being built", () => {
		expect(planRuntimePrune(entries, 1, current)).toEqual([
			"0.0.0-omob.ccccccc.ddddddd",
			"0.0.0-omob.eeeeeee.fffffff",
			"0.0.0-omob.aaaaaaa.bbbbbbb",
		])
	})

	test("never prunes a runtime a live process executes, without charging it to the budget", () => {
		const inUse = new Set(["0.0.0-omob.ccccccc.ddddddd"])
		expect(planRuntimePrune(entries, 2, current, inUse)).toEqual(["0.0.0-omob.eeeeeee.fffffff"])
		expect(planRuntimePrune(entries, 1, current, inUse)).toEqual(["0.0.0-omob.eeeeeee.fffffff", "0.0.0-omob.aaaaaaa.bbbbbbb"])
	})
})

describe("runtimesInUse", () => {
	const runtimeRoot = join(sep, "home", "dev", ".omo", "binary-runtime")
	const names = ["0.0.0-omob.aaaaaaa.bbbbbbb", "0.0.0-omob.aaaaaaa.bbbbbbb2", "0.0.0-omob.ccccccc.ddddddd", "5.0.0-beta.40"]

	test("marks a runtime in use when a process command starts with its provisioned executable", () => {
		const commands = [
			`${join(runtimeRoot, "0.0.0-omob.aaaaaaa.bbbbbbb", "omo")}`,
			`${join(runtimeRoot, "5.0.0-beta.40", "omo")} --resume abc`,
			"/usr/bin/ps -axo command=",
		]
		expect([...runtimesInUse(runtimeRoot, names, commands)].sort()).toEqual(["0.0.0-omob.aaaaaaa.bbbbbbb", "5.0.0-beta.40"])
	})

	test("matches whole directory names, not string prefixes", () => {
		const commands = [`${join(runtimeRoot, "0.0.0-omob.aaaaaaa.bbbbbbb2", "omo")}`]
		expect([...runtimesInUse(runtimeRoot, names, commands)]).toEqual(["0.0.0-omob.aaaaaaa.bbbbbbb2"])
	})

	test("reports nothing when no process runs from the runtime root", () => {
		expect(runtimesInUse(runtimeRoot, names, ["/usr/bin/ps", join(sep, "elsewhere", "omo")]).size).toBe(0)
	})
})

describe("listProcessCommands", () => {
	test("includes a live child spawned by absolute executable path", async () => {
		const child = spawn(process.execPath, ["-e", "process.stdin.once('data', () => console.log('ready')); process.stdin.resume()"], { stdio: ["pipe", "pipe", "ignore"] })
		try {
			const ready = once(child.stdout, "data", { signal: AbortSignal.timeout(5_000) })
			child.stdin.write("start\n")
			await ready
			const commands = listProcessCommands()
			expect(commands.some((command) => command.startsWith(process.execPath))).toBe(true)
		} finally {
			const exited = once(child, "exit", { signal: AbortSignal.timeout(5_000) })
			child.kill()
			await exited
		}
	})
})

describe("pruneOmobRuntimes", () => {
	function runtimeFixture(): { readonly root: string; readonly dir: (name: string) => string } {
		const root = mkdtempSync(join(tmpdir(), "omob-prune-"))
		const dir = (name: string): string => join(root, name)
		for (const [name, mtimeMs] of [
			["0.0.0-omob.old0000.old0000", 1],
			["0.0.0-omob.mid0000.mid0000", 2],
			["0.0.0-omob.new0000.new0000", 3],
			["5.0.0-beta.40", 0],
		] as const) {
			mkdirSync(dir(name), { recursive: true })
			writeFileSync(join(dir(name), "omo"), "#!/bin/sh\n")
			utimesSync(dir(name), mtimeMs, mtimeMs)
		}
		return { root, dir }
	}

	test("deletes idle runtimes beyond the budget but keeps one a live process executes", () => {
		const { root, dir } = runtimeFixture()
		try {
			const processCommands = [`${join(dir("0.0.0-omob.old0000.old0000"), "omo")} --resume x`]
			const kept = pruneOmobRuntimes({ runtimeRoot: root, keep: 1, currentVersion: "0.0.0-omob.cur0000.cur0000", processCommands })
			expect(existsSync(dir("0.0.0-omob.old0000.old0000"))).toBe(true)
			expect(existsSync(dir("0.0.0-omob.mid0000.mid0000"))).toBe(false)
			expect(existsSync(dir("0.0.0-omob.new0000.new0000"))).toBe(false)
			expect(existsSync(dir("5.0.0-beta.40"))).toBe(true)
			expect(kept).toEqual(["0.0.0-omob.old0000.old0000"])
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("is a no-op when the runtime root does not exist", () => {
		expect(pruneOmobRuntimes({ runtimeRoot: join(tmpdir(), "omob-prune-missing-" + process.pid), keep: 1, currentVersion: "x", processCommands: [] })).toEqual([])
	})
})
