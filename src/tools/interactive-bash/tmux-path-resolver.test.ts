/// <reference types="bun-types" />

import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { getTmuxPath, resetTmuxPathCacheForTesting } from "./tmux-path-resolver"

const temporaryDirectories: string[] = []
const originalCmuxSocketPath = process.env.CMUX_SOCKET_PATH
const originalTmux = process.env.TMUX
const originalPath = process.env.PATH
const originalWindowsPath = process.env.Path

async function createTemporaryDirectory(): Promise<string> {
	const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), "tmux-path-resolver-"))
	temporaryDirectories.push(directoryPath)
	return directoryPath
}

async function createExecutable(directoryPath: string, name: string, script: string): Promise<string> {
	const executablePath = path.join(directoryPath, process.platform === "win32" ? `${name}.cmd` : name)
	if (process.platform === "win32") {
		await fs.writeFile(executablePath, "@echo off\r\nexit /b 0\r\n", "utf8")
		return executablePath
	}

	await fs.writeFile(executablePath, script, "utf8")
	await fs.chmod(executablePath, 0o755)
	return executablePath
}

beforeEach(() => {
	resetTmuxPathCacheForTesting()
	delete process.env.CMUX_SOCKET_PATH
	delete process.env.TMUX
	process.env.PATH = originalPath
	if (process.platform === "win32") {
		process.env.Path = originalWindowsPath
	}
})

afterAll(async () => {
	resetTmuxPathCacheForTesting()

	if (originalCmuxSocketPath === undefined) {
		delete process.env.CMUX_SOCKET_PATH
	} else {
		process.env.CMUX_SOCKET_PATH = originalCmuxSocketPath
	}

	if (originalTmux === undefined) {
		delete process.env.TMUX
	} else {
		process.env.TMUX = originalTmux
	}

	process.env.PATH = originalPath
	if (process.platform === "win32") {
		process.env.Path = originalWindowsPath
	}

	for (const directoryPath of temporaryDirectories) {
		await fs.rm(directoryPath, { recursive: true, force: true })
	}
})

describe("getTmuxPath", () => {
	test("#given cmux environment #when cmux is available #then returns cmux without requiring a real tmux binary", async () => {
		// given
		const temporaryDirectory = await createTemporaryDirectory()
		const cmuxPath = await createExecutable(temporaryDirectory, "cmux", "#!/bin/sh\nexit 0\n")
		await createExecutable(temporaryDirectory, "tmux", "#!/bin/sh\nexit 1\n")
		process.env.CMUX_SOCKET_PATH = path.join(temporaryDirectory, "cmux.sock")
		const fixturePath = `${temporaryDirectory}${path.delimiter}${originalPath ?? ""}`
		process.env.PATH = fixturePath
		if (process.platform === "win32") {
			process.env.Path = fixturePath
		}

		// when
		const resolvedPath = await getTmuxPath()

		// then
		expect(path.basename(resolvedPath ?? "")).toBe(path.basename(cmuxPath))
	})
})
