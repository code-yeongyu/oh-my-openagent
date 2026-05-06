/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { resolveCallerTmuxSession } from "./resolve-caller-tmux-session"

type TmuxStub = {
	tmuxPath: string
	logPath: string
}

const temporaryDirectories: string[] = []

function shellSingleQuote(value: string): string {
	return `'${value.split("'").join(`'"'"'`)}'`
}

async function createTmuxStub(options: { stdout: string; exitCode: number }): Promise<TmuxStub> {
	const directory = await mkdtemp(path.join(tmpdir(), "resolve-caller-tmux-session-"))
	temporaryDirectories.push(directory)

	const logPath = path.join(directory, "tmux.log")
	const tmuxPath = path.join(directory, "tmux")
	const script = [
		"#!/bin/sh",
		`printf '%s\\n' \"$@\" >> ${shellSingleQuote(logPath)}`,
		`printf '%s' ${shellSingleQuote(options.stdout)}`,
		`exit ${options.exitCode}`,
	].join("\n")

	await writeFile(tmuxPath, script)
	await chmod(tmuxPath, 0o755)

	return { tmuxPath, logPath }
}

async function readLogLines(logPath: string): Promise<string[]> {
	try {
		const content = await readFile(logPath, "utf8")
		return content.split("\n").filter((line) => line.length > 0)
	} catch {
		return []
	}
}

beforeEach(() => {
	delete process.env.TMUX_PANE
})

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })))
})

describe("resolveCallerTmuxSession", () => {
	test("#given TMUX_PANE unset #when resolve runs #then returns null and makes no tmux calls", async () => {
		// given
		const stub = await createTmuxStub({ stdout: "$7", exitCode: 0 })

		// when
		const result = await resolveCallerTmuxSession(stub.tmuxPath)

		// then
		expect(result).toBeNull()
		expect(await readLogLines(stub.logPath)).toHaveLength(0)
	})

	test("#given TMUX_PANE=%42 and display returns '$7' #when resolve runs #then returns { sessionId: '$7' }", async () => {
		// given
		process.env.TMUX_PANE = "%42"
		const stub = await createTmuxStub({ stdout: "$7", exitCode: 0 })

		// when
		const result = await resolveCallerTmuxSession(stub.tmuxPath)

		// then
		expect(result).toEqual({ sessionId: "$7" })
		expect(await readLogLines(stub.logPath)).toEqual(["display", "-p", "-F", "#{session_id}", "-t", "%42"])
	})

	test("#given TMUX_PANE=%42 and display returns 'garbage' #when resolve runs #then returns null", async () => {
		// given
		process.env.TMUX_PANE = "%42"
		const stub = await createTmuxStub({ stdout: "garbage", exitCode: 0 })

		// when
		const result = await resolveCallerTmuxSession(stub.tmuxPath)

		// then
		expect(result).toBeNull()
	})

	test("#given TMUX_PANE=%42 and display exits non-success #when resolve runs #then returns null", async () => {
		// given
		process.env.TMUX_PANE = "%42"
		const stub = await createTmuxStub({ stdout: "$7", exitCode: 1 })

		// when
		const result = await resolveCallerTmuxSession(stub.tmuxPath)

		// then
		expect(result).toBeNull()
	})
})
