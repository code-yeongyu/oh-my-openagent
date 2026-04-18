import { beforeEach, describe, expect, it, mock } from "bun:test"

type CloseTmuxPane = typeof import("./pane-close").closeTmuxPane

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

const TIMEOUT = Symbol("timeout")
const spawnCalls: SpawnCall[] = []
const queuedProcesses: FakeSubprocess[] = []

function createClosedStream(): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.close()
		},
	})
}

type DrainSignal = { onPull: () => void }

function createDrainSensitiveStream(byteLength: number, signal: DrainSignal): ReadableStream<Uint8Array> {
	let remainingBytes = byteLength
	const chunk = new TextEncoder().encode("x".repeat(16 * 1024))

	return new ReadableStream<Uint8Array>({
		pull(controller) {
			signal.onPull()

			if (remainingBytes <= 0) {
				controller.close()
				return
			}

			const nextChunkSize = Math.min(remainingBytes, chunk.byteLength)
			controller.enqueue(chunk.subarray(0, nextChunkSize))
			remainingBytes -= nextChunkSize
		},
	})
}

function createProcess(exitCode: number): FakeSubprocess {
	return {
		exited: Promise.resolve(exitCode),
		stdout: createClosedStream(),
		stderr: createClosedStream(),
	}
}

function createStdoutSensitiveProcess(exitCode: number, stdoutBytes: number): FakeSubprocess {
	let resolveDrained: () => void = () => undefined
	const drained = new Promise<void>((resolve) => {
		resolveDrained = resolve
	})
	const stdout = createDrainSensitiveStream(stdoutBytes, { onPull: () => resolveDrained() })

	return {
		exited: drained.then(() => exitCode),
		stdout,
		stderr: createClosedStream(),
	}
}

const spawnMock = mock((command: string[], options: { stdout?: string; stderr?: string } = {}): FakeSubprocess => {
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

const paneCloseSpecifier = import.meta.resolve("./pane-close")
const environmentSpecifier = import.meta.resolve("./environment")
const loggerSpecifier = import.meta.resolve("../../logger")
const spawnProcessSpecifier = import.meta.resolve("./spawn-process")
const tmuxPathResolverSpecifier = import.meta.resolve("../../../tools/interactive-bash/tmux-path-resolver")

async function loadCloseTmuxPane(): Promise<CloseTmuxPane> {
	const module = await import(`${paneCloseSpecifier}?test=${crypto.randomUUID()}`)
	return module.closeTmuxPane
}

function registerModuleMocks(): void {
	mock.module(spawnProcessSpecifier, () => ({ spawn: spawnMock }))
	mock.module(environmentSpecifier, () => ({ isInsideTmux: isInsideTmuxMock }))
	mock.module(tmuxPathResolverSpecifier, () => ({ getTmuxPath: getTmuxPathMock }))
	mock.module(loggerSpecifier, () => ({ log: logMock }))
}

function resolveWithin<TResult>(promise: Promise<TResult>, milliseconds: number): Promise<TResult | typeof TIMEOUT> {
	return Promise.race([
		promise,
		new Promise<typeof TIMEOUT>((resolve) => {
			setTimeout(() => resolve(TIMEOUT), milliseconds)
		}),
	])
}

describe("closeTmuxPane", () => {
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

	it("#given pane exists #when closeTmuxPane called #then returns true and invokes send-keys + kill-pane in order", async () => {
		// given
		const closeTmuxPane = await loadCloseTmuxPane()
		queuedProcesses.push(createProcess(0), createProcess(0))

		// when
		const result = await closeTmuxPane("%42")

		// then
		expect(result).toBe(true)
		expect(spawnCalls).toEqual([
			{ command: ["tmux", "send-keys", "-t", "%42", "C-c"], options: { stdout: "ignore", stderr: "ignore" } },
			{ command: ["tmux", "kill-pane", "-t", "%42"], options: { stdout: "pipe", stderr: "pipe" } },
		])
	})

	it("#given not inside tmux #when closeTmuxPane called #then returns false without spawn", async () => {
		// given
		const closeTmuxPane = await loadCloseTmuxPane()
		isInsideTmuxMock.mockImplementation((): boolean => false)

		// when
		const result = await closeTmuxPane("%42")

		// then
		expect(result).toBe(false)
		expect(spawnCalls).toHaveLength(0)
	})

	it("#given tmux not found #when closeTmuxPane called #then returns false without spawn", async () => {
		// given
		const closeTmuxPane = await loadCloseTmuxPane()
		getTmuxPathMock.mockImplementation(async (): Promise<string | undefined> => undefined)

		// when
		const result = await closeTmuxPane("%42")

		// then
		expect(result).toBe(false)
		expect(spawnCalls).toHaveLength(0)
	})

	it("#given kill-pane fails with unknown error #when closeTmuxPane called #then returns false", async () => {
		// given
		const closeTmuxPane = await loadCloseTmuxPane()
		queuedProcesses.push(createProcess(0), createProcess(1))

		// when
		const result = await closeTmuxPane("%42")

		// then
		expect(result).toBe(false)
	})

	it("#given pane already closed by Ctrl+C (kill-pane reports 'can't find pane') #when closeTmuxPane called #then returns true", async () => {
		// given
		const closeTmuxPane = await loadCloseTmuxPane()
		queuedProcesses.push(
			createProcess(0),
			{
				exited: Promise.resolve(1),
				stdout: createClosedStream(),
				stderr: new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("can't find pane: %42\n"))
						controller.close()
					},
				}),
			},
		)

		// when
		const result = await closeTmuxPane("%42")

		// then
		expect(result).toBe(true)
	})

	it("#given kill-pane stdout stream waits for drain #when closeTmuxPane called #then returns true once drainer consumes stdout", async () => {
		// given
		const closeTmuxPane = await loadCloseTmuxPane()
		queuedProcesses.push(createProcess(0), createStdoutSensitiveProcess(0, 16 * 1024))

		// when
		const result = await resolveWithin(closeTmuxPane("%42"), 2000)

		// then
		expect(result).not.toBe(TIMEOUT)
		expect(result).toBe(true)
	})
})
