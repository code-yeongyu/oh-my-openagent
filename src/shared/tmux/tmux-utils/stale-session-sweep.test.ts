import { beforeEach, describe, expect, it, mock } from "bun:test"

type SweepStaleOmoAgentSessions = typeof import("./stale-session-sweep").sweepStaleOmoAgentSessions

type SpawnCall = { command: string[] }

type FakeSubprocess = {
	exited: Promise<number>
	stdout: ReadableStream<Uint8Array>
	stderr: ReadableStream<Uint8Array>
}

const spawnCalls: SpawnCall[] = []
const queuedProcesses: FakeSubprocess[] = []

function createClosedStream(): ReadableStream<Uint8Array> {
	return new ReadableStream({ start(controller) { controller.close() } })
}

function createTextStream(text: string): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(text))
			controller.close()
		},
	})
}

function makeProcess(exitCode: number, stdoutText: string): FakeSubprocess {
	return {
		exited: Promise.resolve(exitCode),
		stdout: createTextStream(stdoutText),
		stderr: createClosedStream(),
	}
}

const spawnMock = mock((command: string[]): FakeSubprocess => {
	spawnCalls.push({ command })
	const process = queuedProcesses.shift()
	if (!process) {
		throw new Error(`No fake subprocess configured for ${command.join(" ")}`)
	}
	return process
})

const isInsideTmuxMock = mock((): boolean => true)
const getTmuxPathMock = mock(async (): Promise<string | undefined> => "tmux")
const logMock = mock(() => undefined)
const killTmuxSessionMock = mock(async (_name: string): Promise<boolean> => true)
const isProcessAliveMock = mock((_pid: number): boolean => false)

const sweepSpecifier = import.meta.resolve("./stale-session-sweep")
const spawnProcessSpecifier = import.meta.resolve("./spawn-process")
const environmentSpecifier = import.meta.resolve("./environment")
const loggerSpecifier = import.meta.resolve("../../logger")
const tmuxPathResolverSpecifier = import.meta.resolve("../../../tools/interactive-bash/tmux-path-resolver")
const sessionKillSpecifier = import.meta.resolve("./session-kill")

function registerModuleMocks(): void {
	mock.module(spawnProcessSpecifier, () => ({ spawn: spawnMock }))
	mock.module(environmentSpecifier, () => ({ isInsideTmux: isInsideTmuxMock }))
	mock.module(loggerSpecifier, () => ({ log: logMock }))
	mock.module(tmuxPathResolverSpecifier, () => ({ getTmuxPath: getTmuxPathMock }))
	mock.module(sessionKillSpecifier, () => ({ killTmuxSessionIfExists: killTmuxSessionMock }))
}

async function loadSweeper(overrideProcessAlive?: (pid: number) => boolean): Promise<SweepStaleOmoAgentSessions> {
	const originalKill = process.kill
	const processAlive = overrideProcessAlive ?? isProcessAliveMock
	process.kill = ((pid: number, signal?: number | string): true => {
		if (signal === 0) {
			if (processAlive(pid)) {
				return true
			}
			const err = new Error("ESRCH") as NodeJS.ErrnoException
			err.code = "ESRCH"
			throw err
		}
		return originalKill.call(process, pid, signal)
	}) as typeof process.kill
	const module = await import(`${sweepSpecifier}?test=${crypto.randomUUID()}`)
	return module.sweepStaleOmoAgentSessions
}

describe("sweepStaleOmoAgentSessions", () => {
	beforeEach(() => {
		registerModuleMocks()
		spawnCalls.length = 0
		queuedProcesses.length = 0
		spawnMock.mockClear()
		isInsideTmuxMock.mockClear()
		getTmuxPathMock.mockClear()
		logMock.mockClear()
		killTmuxSessionMock.mockClear()
		isProcessAliveMock.mockClear()

		isInsideTmuxMock.mockImplementation((): boolean => true)
		getTmuxPathMock.mockImplementation(async (): Promise<string | undefined> => "tmux")
		killTmuxSessionMock.mockImplementation(async (_name: string): Promise<boolean> => true)
		isProcessAliveMock.mockImplementation((_pid: number): boolean => false)
	})

	it("#given not inside tmux #when sweepStaleOmoAgentSessions called #then returns 0 without spawn", async () => {
		// given
		isInsideTmuxMock.mockImplementation((): boolean => false)
		const sweep = await loadSweeper()

		// when
		const result = await sweep()

		// then
		expect(result).toBe(0)
		expect(spawnCalls).toHaveLength(0)
	})

	it("#given no omo-agents sessions exist #when sweepStaleOmoAgentSessions called #then returns 0", async () => {
		// given
		queuedProcesses.push(makeProcess(0, "other-session\nmain\n"))
		const sweep = await loadSweeper()

		// when
		const result = await sweep()

		// then
		expect(result).toBe(0)
		expect(killTmuxSessionMock).toHaveBeenCalledTimes(0)
	})

	it("#given omo-agents sessions with dead PIDs #when sweepStaleOmoAgentSessions called #then each dead session is killed", async () => {
		// given
		queuedProcesses.push(makeProcess(0, "omo-agents-99991\nomo-agents-99992\nunrelated\n"))
		const sweep = await loadSweeper(() => false)

		// when
		const result = await sweep()

		// then
		expect(result).toBe(2)
		expect(killTmuxSessionMock).toHaveBeenCalledTimes(2)
		expect(killTmuxSessionMock.mock.calls[0]?.[0]).toBe("omo-agents-99991")
		expect(killTmuxSessionMock.mock.calls[1]?.[0]).toBe("omo-agents-99992")
	})

	it("#given session matches current PID #when sweepStaleOmoAgentSessions called #then it is not killed", async () => {
		// given
		queuedProcesses.push(makeProcess(0, `omo-agents-${process.pid}\nomo-agents-99999\n`))
		const sweep = await loadSweeper(() => false)

		// when
		const result = await sweep()

		// then
		expect(result).toBe(1)
		expect(killTmuxSessionMock).toHaveBeenCalledTimes(1)
		expect(killTmuxSessionMock.mock.calls[0]?.[0]).toBe("omo-agents-99999")
	})

	it("#given session PID is still alive #when sweepStaleOmoAgentSessions called #then it is not killed", async () => {
		// given
		queuedProcesses.push(makeProcess(0, "omo-agents-88888\n"))
		const sweep = await loadSweeper((pid) => pid === 88888)

		// when
		const result = await sweep()

		// then
		expect(result).toBe(0)
		expect(killTmuxSessionMock).toHaveBeenCalledTimes(0)
	})

	it("#given list-sessions fails #when sweepStaleOmoAgentSessions called #then returns 0 without killing", async () => {
		// given
		queuedProcesses.push(makeProcess(1, ""))
		const sweep = await loadSweeper(() => false)

		// when
		const result = await sweep()

		// then
		expect(result).toBe(0)
		expect(killTmuxSessionMock).toHaveBeenCalledTimes(0)
	})
})
