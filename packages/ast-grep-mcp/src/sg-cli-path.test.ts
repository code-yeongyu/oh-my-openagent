import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { executableCandidates, findSgCliPathSync, isValidBinary } from "./sg-cli-path"

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

function writeFakeSgBinary(path: string): void {
	writeFileSync(path, Buffer.alloc(20001, 0x61))
}

function createRuntimeDirSg(codexHome: string, platformArch: string, binaryName: string): string {
	const runtimeDirectory = join(codexHome, "runtime", "ast-grep", platformArch)
	mkdirSync(runtimeDirectory, { recursive: true })
	const binaryPath = join(runtimeDirectory, binaryName)
	writeFakeSgBinary(binaryPath)
	return binaryPath
}

function rejectModuleResolution(specifier: string): string {
	throw new Error(`Cannot find module '${specifier}'`)
}

describe("findSgCliPathSync resolution order", () => {
	it("prefers the OMO_AST_GREP_SG_PATH env override over every other step", () => {
		const overrideDirectory = createTemporaryDirectory("omo-sg-env-override-")
		const overridePath = join(overrideDirectory, "sg")
		writeFakeSgBinary(overridePath)
		const codexHome = createTemporaryDirectory("omo-sg-codex-home-")
		createRuntimeDirSg(codexHome, "darwin-arm64", "sg")

		const resolved = findSgCliPathSync({
			env: { OMO_AST_GREP_SG_PATH: overridePath, CODEX_HOME: codexHome },
			platform: "darwin",
			arch: "arm64",
			homedir: () => "/nonexistent-home",
			resolveModulePath: rejectModuleResolution,
		})

		expect(resolved).toBe(overridePath)
	})

	it("falls through without throwing when the env override points at a missing file", () => {
		const codexHome = createTemporaryDirectory("omo-sg-codex-home-")
		const runtimeBinaryPath = createRuntimeDirSg(codexHome, "darwin-arm64", "sg")

		const resolved = findSgCliPathSync({
			env: { OMO_AST_GREP_SG_PATH: "/nope/sg", CODEX_HOME: codexHome },
			platform: "darwin",
			arch: "arm64",
			homedir: () => "/nonexistent-home",
			resolveModulePath: rejectModuleResolution,
		})

		expect(resolved).toBe(runtimeBinaryPath)
	})

	it("resolves the CODEX_HOME runtime dir before the Homebrew fallback", () => {
		const codexHome = createTemporaryDirectory("omo-sg-codex-home-")
		const runtimeBinaryPath = createRuntimeDirSg(codexHome, "darwin-arm64", "sg")

		const resolved = findSgCliPathSync({
			env: { CODEX_HOME: codexHome },
			platform: "darwin",
			arch: "arm64",
			homedir: () => "/nonexistent-home",
			resolveModulePath: rejectModuleResolution,
		})

		expect(resolved).toBe(runtimeBinaryPath)
	})

	it("falls back to <homedir>/.codex when CODEX_HOME is unset", () => {
		const homeDirectory = createTemporaryDirectory("omo-sg-home-")
		const runtimeBinaryPath = createRuntimeDirSg(join(homeDirectory, ".codex"), "linux-x64", "sg")

		const resolved = findSgCliPathSync({
			env: {},
			platform: "linux",
			arch: "x64",
			homedir: () => homeDirectory,
			resolveModulePath: rejectModuleResolution,
		})

		expect(resolved).toBe(runtimeBinaryPath)
	})

	it("treats a blank CODEX_HOME as unset", () => {
		const homeDirectory = createTemporaryDirectory("omo-sg-home-")
		const runtimeBinaryPath = createRuntimeDirSg(join(homeDirectory, ".codex"), "linux-x64", "sg")

		const resolved = findSgCliPathSync({
			env: { CODEX_HOME: "   " },
			platform: "linux",
			arch: "x64",
			homedir: () => homeDirectory,
			resolveModulePath: rejectModuleResolution,
		})

		expect(resolved).toBe(runtimeBinaryPath)
	})

	it("probes sg.exe in the runtime dir on win32", () => {
		const codexHome = createTemporaryDirectory("omo-sg-codex-home-")
		const runtimeBinaryPath = createRuntimeDirSg(codexHome, "win32-x64", "sg.exe")

		const resolved = findSgCliPathSync({
			env: { CODEX_HOME: codexHome },
			platform: "win32",
			arch: "x64",
			homedir: () => "/nonexistent-home",
			resolveModulePath: rejectModuleResolution,
		})

		expect(resolved).toBe(runtimeBinaryPath)
	})

	it("returns null when every step misses, including a bogus env override", () => {
		const codexHome = createTemporaryDirectory("omo-sg-codex-home-")

		const resolved = findSgCliPathSync({
			env: { OMO_AST_GREP_SG_PATH: "/nope/sg", CODEX_HOME: codexHome },
			platform: "linux",
			arch: "x64",
			homedir: () => "/nonexistent-home",
			resolveModulePath: rejectModuleResolution,
		})

		expect(resolved).toBeNull()
	})
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

	it("rejects directories named like Windows command shims", () => {
		const directory = createTemporaryDirectory("omo-sg-cli-directory-")
		const shimDirectoryPath = join(directory, "sg.cmd")
		mkdirSync(shimDirectoryPath)

		expect(isValidBinary(shimDirectoryPath)).toBe(false)
	})
})
