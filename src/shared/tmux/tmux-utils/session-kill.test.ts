import { beforeEach, describe, expect, it, mock } from "bun:test"

type KillTmuxSessionIfExists = typeof import("./session-kill").killTmuxSessionIfExists

type SpawnCall = {
	command: string[]
	options: {
		stdout?: string
		stderr?: string
	}
}

type FakeSubprocess = {
	exited: Promise<number>
	stdout: ReadableStream<Uint8Array>
	stderr: ReadableStream<Uint8Array>
}

const spawnCalls: SpawnCall[] = []
const queuedProcesses: FakeSubprocess[] = []

function createStream(chunks: string[] = []): ReadableStream<Uint8Array> {
	const textEncoder = new TextEncoder()

	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(textEncoder.encode(chunk))
			}

			controller.close()
		},
	})
}

function createProcess(exitCode: number, output: { stdout?: string[]; stderr?: string[] } = {}): FakeSubprocess {
	return {
		exited: Promise.resolve(exitCode),
		stdout: createStream(output.stdout),
		stderr: createStream(output.stderr),
	}
}

const spawnMock = mock((command: string[], options: { stdout?: string; stderr?: string } = {}) => {
	spawnCalls.push({ command, options })

	const process = queuedProcesses.shift()
	if (!process) {
		throw new Error(`No fake subprocess configured for ${command.join(" ")}`)
	}

	return process
})

const isInsideTmuxMock = mock((): boolean => true)
const getTmuxPathMock = mock(async (): Promise<string | undefined> => "tmux")
const logMock = mock(() => undefined)

const sessionKillSpecifier = import.meta.resolve("./session-kill")
const environmentSpecifier = import.meta.resolve("./environment")
const loggerSpecifier = import.meta.resolve("../../logger")
const spawnProcessSpecifier = import.meta.resolve("./spawn-process")
const tmuxPathResolverSpecifier = import.meta.resolve("../../../tools/interactive-bash/tmux-path-resolver")

async function loadKillTmuxSessionIfExists(): Promise<typeof KillTmuxSessionIfExists> {
	const module = await import(`${sessionKillSpecifier}?test=${crypto.randomUUID()}`)
	return module.killTmuxSessionIfExists
}

function registerModuleMocks(): void {
	mock.module(spawnProcessSpecifier, () => ({ spawn: spawnMock }))
	mock.module(environmentSpecifier, () => ({ isInsideTmux: isInsideTmuxMock }))
	mock.module(tmuxPathResolverSpecifier, () => ({ getTmuxPath: getTmuxPathMock }))
	mock.module(loggerSpecifier, () => ({ log: logMock }))
}

describe("killTmuxSessionIfExists", () => {
	beforeEach(() => {
		registerModuleMocks()
		spawnCalls.length = 0
		queuedProcesses.length = 0
		spawnMock.mockClear()
		isInsideTmuxMock.mockClear()
		getTmuxPathMock.mockClear()
		logMock.mockClear()

		isInsideTmuxMock.mockImplementation((): boolean => true)
		getTmuxPathMock.mockImplementation(async (): Promise<string | undefined> => "tmux")
	})

	it("#given omo-agents session exists #when killTmuxSessionIfExists called #then kill-session invoked and returns true", async () => {
		// given
		const killTmuxSessionIfExists = await loadKillTmuxSessionIfExists()
		queuedProcesses.push(createProcess(0), createProcess(0, { stdout: ["killed"], stderr: [] }))

		// when
		const result = await killTmuxSessionIfExists("omo-agents")

		// then
		expect(result).toBe(true)
		expect(spawnCalls).toEqual([
			{
				command: ["tmux", "has-session", "-t", "omo-agents"],
				options: { stdout: "ignore", stderr: "ignore" },
			},
			{
				command: ["tmux", "kill-session", "-t", "omo-agents"],
				options: { stdout: "pipe", stderr: "pipe" },
			},
		])
	})

	it("#given omo-agents session does NOT exist (has-session exits non-zero) #when killTmuxSessionIfExists called #then NO kill-session invocation and returns false", async () => {
		// given
		const killTmuxSessionIfExists = await loadKillTmuxSessionIfExists()
		queuedProcesses.push(createProcess(1))

		// when
		const result = await killTmuxSessionIfExists("omo-agents")

		// then
		expect(result).toBe(false)
		expect(spawnCalls).toEqual([
			{
				command: ["tmux", "has-session", "-t", "omo-agents"],
				options: { stdout: "ignore", stderr: "ignore" },
			},
		])
	})

	it("#given not inside tmux #when killTmuxSessionIfExists called #then returns false without any spawn", async () => {
		// given
		const killTmuxSessionIfExists = await loadKillTmuxSessionIfExists()
		isInsideTmuxMock.mockReturnValue(false)

		// when
		const result = await killTmuxSessionIfExists("omo-agents")

		// then
		expect(result).toBe(false)
		expect(spawnCalls).toHaveLength(0)
		expect(getTmuxPathMock).toHaveBeenCalledTimes(0)
	})

	it("#given tmux not found #when killTmuxSessionIfExists called #then returns false without spawn", async () => {
		// given
		const killTmuxSessionIfExists = await loadKillTmuxSessionIfExists()
		getTmuxPathMock.mockResolvedValue(undefined)

		// when
		const result = await killTmuxSessionIfExists("omo-agents")

		// then
		expect(result).toBe(false)
		expect(spawnCalls).toHaveLength(0)
	})

	it("#given kill-session itself fails (e.g., race between has-session and kill) #when killTmuxSessionIfExists called #then returns false but does not throw", async () => {
		// given
		const killTmuxSessionIfExists = await loadKillTmuxSessionIfExists()
		queuedProcesses.push(
			createProcess(0),
			createProcess(1, { stdout: [], stderr: ["no session"] }),
		)

		// when
		const result = await killTmuxSessionIfExists("omo-agents")

		// then
		expect(result).toBe(false)
		expect(spawnCalls).toHaveLength(2)
	})
})
