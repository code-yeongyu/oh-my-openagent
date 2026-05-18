/// <reference types="bun-types" />

import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { runTmuxCommand } from "./runner"

const temporaryDirectories: string[] = []
const originalCmuxSocketPath = process.env.CMUX_SOCKET_PATH
const originalTmux = process.env.TMUX
const originalPath = process.env.PATH

async function createTemporaryDirectory(): Promise<string> {
	const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), "tmux-runner-"))
	temporaryDirectories.push(directoryPath)
	return directoryPath
}

async function readInvocationCount(counterFilePath: string): Promise<number> {
	const count = await fs.readFile(counterFilePath, "utf8")
	return Number.parseInt(count, 10)
}

async function createFakeCmux(directoryPath: string, argsFilePath: string): Promise<string> {
	const cmuxPath = path.join(directoryPath, "cmux")
	const script = [
		"#!/bin/sh",
		"printf '%s\\n' \"$@\" > \"$1.args\"",
		"printf '%s\\n' '%42'",
	].join("\n")
	await fs.writeFile(cmuxPath, script.replace("$1.args", argsFilePath), "utf8")
	await fs.chmod(cmuxPath, 0o755)
	return cmuxPath
}

beforeEach(() => {
	delete process.env.CMUX_SOCKET_PATH
	delete process.env.TMUX
	process.env.PATH = originalPath
})

afterAll(async () => {
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

	for (const directoryPath of temporaryDirectories) {
		await fs.rm(directoryPath, { recursive: true, force: true })
	}
})

describe("runTmuxCommand", () => {
	test("#given cmux socket and real tmux session #when run #then uses requested executable instead of cmux compat", async () => {
		// given
		const originalCmuxSocketPath = process.env.CMUX_SOCKET_PATH
		const originalTmux = process.env.TMUX
		process.env.CMUX_SOCKET_PATH = "/tmp/cmux.sock"
		process.env.TMUX = "/private/tmp/tmux-501/default,123,0"

		try {
			// when
			const result = await runTmuxCommand("sh", ["-c", "printf '%s\\n' real-tmux"])

			// then
			expect(result).toEqual({
				success: true,
				output: "real-tmux",
				stdout: "real-tmux",
				stderr: "",
				exitCode: 0,
			})
		} finally {
			if (originalCmuxSocketPath === undefined) delete process.env.CMUX_SOCKET_PATH
			else process.env.CMUX_SOCKET_PATH = originalCmuxSocketPath
			if (originalTmux === undefined) delete process.env.TMUX
			else process.env.TMUX = originalTmux
		}
	})

	test("#given command exits 0 with stdout #when run #then success true, output and stdout equal trimmed value, stderr empty", async () => {
		// given
		const commandArguments = ["-c", "printf '%s\\n' '%42'"]

		// when
		const result = await runTmuxCommand("sh", commandArguments)

		// then
		expect(result).toEqual({
			success: true,
			output: "%42",
			stdout: "%42",
			stderr: "",
			exitCode: 0,
		})
	})

	test("#given command exits 1 with stderr #when run #then success false, stderr populated", async () => {
		// given
		const commandArguments = ["-c", "printf '%s\\n' 'some error' >&2; exit 1"]

		// when
		const result = await runTmuxCommand("sh", commandArguments)

		// then
		expect(result.success).toBe(false)
		expect(result.stderr).toBe("some error")
		expect(result.exitCode).toBe(1)
	})

	test("#given retry=2 and first exit nonzero #when run #then calls spawn twice before returning failure", async () => {
		// given
		const temporaryDirectory = await createTemporaryDirectory()
		const counterFilePath = path.join(temporaryDirectory, `${randomUUID()}.count`)
		const commandScript = `counter_file="$1"; count=0; if [ -f "$counter_file" ]; then count=$(cat "$counter_file"); fi; count=$((count + 1)); printf '%s' "$count" > "$counter_file"; printf '%s\\n' 'temporary error' >&2; exit 1`

		// when
		const result = await runTmuxCommand("sh", ["-c", commandScript, "sh", counterFilePath], { retry: 2 })

		// then
		expect(result.success).toBe(false)
		expect(result.stderr).toBe("temporary error")
		expect(await readInvocationCount(counterFilePath)).toBe(3)
	})

	test("#given retry=2 and stderr contains 'can't find pane' #when run #then does NOT retry", async () => {
		// given
		const temporaryDirectory = await createTemporaryDirectory()
		const counterFilePath = path.join(temporaryDirectory, `${randomUUID()}.count`)
		const commandScript = `counter_file="$1"; count=0; if [ -f "$counter_file" ]; then count=$(cat "$counter_file"); fi; count=$((count + 1)); printf '%s' "$count" > "$counter_file"; printf '%s\\n' "can't find pane: %1" >&2; exit 1`

		// when
		const result = await runTmuxCommand("sh", ["-c", commandScript, "sh", counterFilePath], { retry: 2 })

		// then
		expect(result.success).toBe(false)
		expect(result.stderr).toContain("can't find pane")
		expect(await readInvocationCount(counterFilePath)).toBe(1)
	})

	test("#given timeoutMs=50 and command sleeps 500ms #when run #then returns timeout failure", async () => {
		// given
		const commandArguments = ["-c", "sleep 0.5"]

		// when
		const result = await runTmuxCommand("sh", commandArguments, { timeoutMs: 50 })

		// then
		expect(result.success).toBe(false)
		expect(result.exitCode).toBe(-1)
		expect(result.stderr).toContain("timeout")
	})

	test("#given stdout contains trailing newline #when run #then output is trimmed", async () => {
		// given
		const commandArguments = ["-c", "printf '%s\\n\\n' '%7'"]

		// when
		const result = await runTmuxCommand("sh", commandArguments)

		// then
		expect(result.output).toBe("%7")
		expect(result.stdout).toBe("%7")
	})

	test("#given backward-compat consumer destructures {success, output} #when result returned #then both fields present and correct", async () => {
		// given
		const commandArguments = ["-c", "printf '%s\\n' '%9'"]

		// when
		const { success, output } = await runTmuxCommand("sh", commandArguments)

		// then
		expect(success).toBe(true)
		expect(output).toBe("%9")
	})

	test("#given cmux environment #when run #then delegates through cmux tmux compatibility command", async () => {
		// given
		const temporaryDirectory = await createTemporaryDirectory()
		const argsFilePath = path.join(temporaryDirectory, "cmux.args")
		const cmuxPath = await createFakeCmux(temporaryDirectory, argsFilePath)
		process.env.CMUX_SOCKET_PATH = path.join(temporaryDirectory, "cmux.sock")
		process.env.PATH = `${temporaryDirectory}${path.delimiter}${originalPath ?? ""}`

		// when
		const result = await runTmuxCommand(cmuxPath, ["display-message", "-p", "#{pane_id}"])

		// then
		expect(result).toEqual({
			success: true,
			output: "%42",
			stdout: "%42",
			stderr: "",
			exitCode: 0,
		})
		await expect(fs.readFile(argsFilePath, "utf8")).resolves.toBe("__tmux-compat\ndisplay-message\n-p\n#{pane_id}\n")
	})
})
