/// <reference types="bun-types" />

import { afterAll, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { runTmuxCommand } from "./runner"

const temporaryDirectories: string[] = []

async function createTemporaryDirectory(): Promise<string> {
	const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), "tmux-runner-"))
	temporaryDirectories.push(directoryPath)
	return directoryPath
}

async function readInvocationCount(counterFilePath: string): Promise<number> {
	const count = await fs.readFile(counterFilePath, "utf8")
	return Number.parseInt(count, 10)
}

afterAll(async () => {
	for (const directoryPath of temporaryDirectories) {
		await fs.rm(directoryPath, { recursive: true, force: true })
	}
})

describe("runTmuxCommand", () => {
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
})
