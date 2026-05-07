/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"

import * as spawnHelpers from "../../shared/spawn-with-windows-hide"
import * as configContext from "./config-context"

type OpenCodeBinaryModule = typeof import("./opencode-binary")

type CreateProcOptions = {
	exitCode?: number | null
	exited?: Promise<number>
	stdout?: string
	stderr?: string
}

function createProc(options: CreateProcOptions = {}): ReturnType<typeof spawnHelpers.spawnWithWindowsHide> {
	const exitCode = options.exitCode ?? 0

	return {
		exited: options.exited ?? Promise.resolve(exitCode),
		exitCode,
		stdout: options.stdout !== undefined ? new Blob([options.stdout]).stream() : undefined,
		stderr: options.stderr !== undefined ? new Blob([options.stderr]).stream() : undefined,
		kill: () => {},
	} satisfies ReturnType<typeof spawnHelpers.spawnWithWindowsHide>
}

describe("getOpenCodeVersion", () => {
	let spawnSpy: ReturnType<typeof spyOn>
	let initConfigContextSpy: ReturnType<typeof spyOn>
	let getOpenCodeVersion: OpenCodeBinaryModule["getOpenCodeVersion"]
	let isOpenCodeInstalled: OpenCodeBinaryModule["isOpenCodeInstalled"]

	beforeEach(async () => {
		initConfigContextSpy = spyOn(configContext, "initConfigContext").mockImplementation(() => {})
		const mod = await import(`./opencode-binary?test=${Date.now()}-${Math.random()}`)
		getOpenCodeVersion = mod.getOpenCodeVersion
		isOpenCodeInstalled = mod.isOpenCodeInstalled
	})

	afterEach(() => {
		spawnSpy?.mockRestore()
		initConfigContextSpy?.mockRestore()
	})

	describe("#given the CLI binary returns a real version on stdout", () => {
		it("#then returns that version", async () => {
			spawnSpy = spyOn(spawnHelpers, "spawnWithWindowsHide").mockReturnValue(
				createProc({ exitCode: 0, stdout: "1.14.39\n" }),
			)

			const version = await getOpenCodeVersion()

			expect(version).toBe("1.14.39")
		})
	})

	describe("#given the OpenCode Desktop GUI launches and exits cleanly with no version output (fixes #3766)", () => {
		it("#then treats the binary as not-installed instead of returning empty version", async () => {
			spawnSpy = spyOn(spawnHelpers, "spawnWithWindowsHide").mockReturnValue(
				createProc({ exitCode: 0, stdout: "" }),
			)

			const installed = await isOpenCodeInstalled()
			const version = await getOpenCodeVersion()

			expect(installed).toBe(false)
			expect(version).toBe(null)
			expect(initConfigContextSpy).not.toHaveBeenCalled()
		})

		it("#then a whitespace-only stdout is also rejected", async () => {
			spawnSpy = spyOn(spawnHelpers, "spawnWithWindowsHide").mockReturnValue(
				createProc({ exitCode: 0, stdout: "   \n  \t  " }),
			)

			const version = await getOpenCodeVersion()

			expect(version).toBe(null)
		})

		it("#then non-version stdout (e.g. a Tauri startup banner) is rejected", async () => {
			spawnSpy = spyOn(spawnHelpers, "spawnWithWindowsHide").mockReturnValue(
				createProc({ exitCode: 0, stdout: "OpenCode Desktop\nLoading window...\n" }),
			)

			const version = await getOpenCodeVersion()

			expect(version).toBe(null)
		})
	})

	describe("#given the binary exits non-zero", () => {
		it("#then returns null (not installed)", async () => {
			spawnSpy = spyOn(spawnHelpers, "spawnWithWindowsHide").mockReturnValue(
				createProc({ exitCode: 1, stdout: "" }),
			)

			const version = await getOpenCodeVersion()

			expect(version).toBe(null)
		})
	})
})
