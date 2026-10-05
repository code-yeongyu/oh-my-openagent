import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { ENGINE_ABI, PROTOCOL_VERSION } from "@oh-my-opencode/senpi-desktop-protocol";

/** The `engine.hello` reply of an engine this package accepts. */
export interface EngineHello {
	readonly protocolVersion: typeof PROTOCOL_VERSION;
	readonly engineVersion: string;
	readonly buildSha: string;
	readonly abi: typeof ENGINE_ABI;
}

export interface EngineContract {
	readonly abi: string;
	readonly protocolVersion: string;
}

/** Starts the engine process; injectable so tests can run a script engine through `node`. */
export type DesktopEngineSpawner = (enginePath: string, args: readonly string[]) => ChildProcessWithoutNullStreams;

export interface HelloOptions {
	/** Bounds the whole handshake: spawn, reply, and exit at stdin EOF. */
	readonly timeoutMs?: number;
	readonly spawnEngine?: DesktopEngineSpawner;
}

export const HELLO_TIMEOUT_MS = 10_000;
const HELLO_REQUEST_ID = 1;
const STDERR_TAIL_BYTES = 4096;

/** The ABI sentinel: the engine answered, but speaks a contract this host does not. */
export class DesktopEngineAbiMismatchError extends Error {
	readonly code = "abi-mismatch";
	readonly enginePath: string;
	readonly expected: EngineContract;
	readonly actual: EngineContract;

	constructor(enginePath: string, actual: EngineContract) {
		const expected = { abi: ENGINE_ABI, protocolVersion: PROTOCOL_VERSION };
		super(
			`desktop engine ABI mismatch at ${enginePath}: expected abi ${expected.abi} protocol ${expected.protocolVersion}, engine reported abi ${actual.abi} protocol ${actual.protocolVersion}`,
		);
		this.name = "DesktopEngineAbiMismatchError";
		this.enginePath = enginePath;
		this.expected = expected;
		this.actual = actual;
	}
}

/** The engine never produced a well-formed `engine.hello` reply. */
export class DesktopEngineHandshakeError extends Error {
	readonly code = "handshake-failed";
	readonly enginePath: string;

	constructor(enginePath: string, reason: string) {
		super(`desktop engine handshake failed at ${enginePath}: ${reason}`);
		this.name = "DesktopEngineHandshakeError";
		this.enginePath = enginePath;
	}
}

const defaultSpawner: DesktopEngineSpawner = (enginePath, args) =>
	spawn(enginePath, args, { stdio: "pipe", windowsHide: true });

/** Spawns the engine with `--stdio`, sends `engine.hello`, and accepts only the host's ABI and protocol. */
export async function helloDesktopEngine(enginePath: string, options: HelloOptions = {}): Promise<EngineHello> {
	const result = await requestHello(enginePath, options);
	if (!isRecord(result) || !isHelloShape(result)) {
		throw new DesktopEngineHandshakeError(enginePath, `malformed engine.hello result ${JSON.stringify(result)}`);
	}
	if (result.abi !== ENGINE_ABI || result.protocolVersion !== PROTOCOL_VERSION) {
		throw new DesktopEngineAbiMismatchError(enginePath, { abi: result.abi, protocolVersion: result.protocolVersion });
	}
	return {
		protocolVersion: PROTOCOL_VERSION,
		engineVersion: result.engineVersion,
		buildSha: result.buildSha,
		abi: ENGINE_ABI,
	};
}

type Outcome = { readonly ok: true; readonly result: unknown } | { readonly ok: false; readonly reason: string };

function requestHello(enginePath: string, options: HelloOptions): Promise<unknown> {
	const timeoutMs = options.timeoutMs ?? HELLO_TIMEOUT_MS;
	const child = (options.spawnEngine ?? defaultSpawner)(enginePath, ["--stdio"]);
	return new Promise((resolve, reject) => {
		let outcome: Outcome | undefined;
		let stderrTail = "";
		// The first outcome wins; ending stdin then lets the engine exit at EOF.
		const settle = (next: Outcome) => {
			if (outcome !== undefined) return;
			outcome = next;
			child.stdin.end();
		};
		const timer = setTimeout(() => {
			settle({ ok: false, reason: `no engine.hello reply and exit within ${timeoutMs} ms` });
			child.kill("SIGKILL");
		}, timeoutMs);

		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
		});
		createInterface({ input: child.stdout }).on("line", (line) => settleFromLine(line, settle));
		child.stdin.on("error", (error) => settle({ ok: false, reason: `stdin: ${error.message}` }));
		child.on("error", (error) => settle({ ok: false, reason: `spawn: ${error.message}` }));
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			const final = outcome ?? {
				ok: false,
				reason: `engine exited (code ${code ?? "null"}, signal ${signal ?? "null"}) before replying; stderr: ${stderrTail.trim() || "<empty>"}`,
			};
			if (final.ok) resolve(final.result);
			else reject(new DesktopEngineHandshakeError(enginePath, final.reason));
		});

		child.stdin.write(
			`${JSON.stringify({ jsonrpc: "2.0", id: HELLO_REQUEST_ID, method: "engine.hello", params: {} })}\n`,
		);
	});
}

function settleFromLine(line: string, settle: (outcome: Outcome) => void): void {
	const message = parseJsonLine(line);
	if (message === undefined) {
		settle({ ok: false, reason: `non-JSON output line ${JSON.stringify(line)}` });
		return;
	}
	// Notifications (e.g. `engine.log`) may precede the reply; only our id settles.
	if (!isRecord(message) || message.id !== HELLO_REQUEST_ID) return;
	if ("result" in message) {
		settle({ ok: true, result: message.result });
		return;
	}
	settle({ ok: false, reason: `engine.hello returned an error ${JSON.stringify(message.error)}` });
}

function parseJsonLine(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch (error) {
		if (error instanceof SyntaxError) return undefined;
		throw error;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isHelloShape(value: Record<string, unknown>): value is Record<keyof EngineHello, string> {
	return (
		typeof value.protocolVersion === "string" &&
		typeof value.engineVersion === "string" &&
		typeof value.buildSha === "string" &&
		typeof value.abi === "string"
	);
}
