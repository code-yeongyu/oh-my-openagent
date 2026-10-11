import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
	type AcquireDesktopEngineOptions,
	type AcquiredDesktopEngine,
	acquireDesktopEngine,
	type DesktopEngineLocateDiagnostic,
	getDesktopEngineHost,
	launchDesktopEngine,
	locateDesktopEngine,
} from "@oh-my-opencode/senpi-desktop-engine";

/**
 * Starts one engine child speaking NDJSON JSON-RPC on its stdio; injectable so tests run a script engine.
 * It may resolve asynchronously when the binary has to be acquired first.
 */
export type ChildFactory = () => ChildProcessWithoutNullStreams | Promise<ChildProcessWithoutNullStreams>;

const STDERR_TAIL_CHARS = 4096;

/** No engine binary is available for this host. */
export class DesktopEngineUnavailableError extends Error {
	readonly diagnostic: DesktopEngineLocateDiagnostic;

	constructor(diagnostic: DesktopEngineLocateDiagnostic) {
		super(`${diagnostic.message} ${diagnostic.cause}`);
		this.name = "DesktopEngineUnavailableError";
		this.diagnostic = diagnostic;
	}
}

/**
 * The engine spawn contract: the binary at `enginePath` (default: the one the engine package locates)
 * with the single argument `--stdio` and piped stdio. The child inherits the environment, which carries
 * `SENPI_DESKTOP_BACKEND` and, on Linux, the display and session-bus variables.
 */
export function engineChildFactory(enginePath?: string): ChildFactory {
	return () => spawnEngine(enginePath ?? locateEnginePath());
}

export interface AcquiringEngineChildOptions {
	/** The omo release whose GitHub assets carry this host's engine. */
	readonly version: string;
	readonly host?: string;
	readonly acquire?: (options: AcquireDesktopEngineOptions) => Promise<AcquiredDesktopEngine>;
	readonly spawnEngine?: (enginePath: string) => ChildProcessWithoutNullStreams;
}

/**
 * Each spawn acquires the requested release again and holds its launch lock through spawn.
 * Local engines retain their original path; signed releases use the stable permission-bearing path.
 */
export function acquiringEngineChildFactory(options: AcquiringEngineChildOptions): ChildFactory {
	const acquire = options.acquire ?? acquireDesktopEngine;
	const start = options.spawnEngine ?? spawnEngine;
	return async () => {
		const result = await launchDesktopEngine(
			{ version: options.version, host: options.host ?? getDesktopEngineHost() },
			start,
			acquire,
		);
		if (result.path === null) throw new DesktopEngineUnavailableError(result.diagnostic);
		return result.value;
	};
}

function spawnEngine(enginePath: string): ChildProcessWithoutNullStreams {
	return spawn(enginePath, ["--stdio"], { stdio: "pipe", windowsHide: true });
}

function locateEnginePath(): string {
	const location = locateDesktopEngine();
	if (location.path === null) throw new DesktopEngineUnavailableError(location.diagnostic);
	return location.path;
}

export interface EngineChildEvents {
	readonly onLine: (line: string) => void;
	/** Called once, after stdout has drained, with why the child is gone. */
	readonly onExit: (reason: string) => void;
}

/** One engine process: NDJSON framing on stdout, a stderr tail for diagnostics, and a single kill. */
export class EngineChild {
	readonly path: string;
	readonly exited: Promise<void>;
	readonly #process: ChildProcessWithoutNullStreams;
	#stderrTail = "";
	#failure = "";
	#alive = true;

	constructor(process: ChildProcessWithoutNullStreams, events: EngineChildEvents) {
		this.#process = process;
		this.path = process.spawnfile;
		process.stderr.setEncoding("utf8");
		// Drained so a chatty engine never blocks on a full stderr pipe.
		process.stderr.on("data", (chunk: string) => {
			this.#stderrTail = (this.#stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
		});
		process.stdin.on("error", (error) => this.#recordFailure(`stdin: ${error.message}`));
		process.on("error", (error) => this.#recordFailure(`spawn: ${error.message}`));
		createInterface({ input: process.stdout }).on("line", events.onLine);
		this.exited = new Promise((resolve) => {
			// `close` fires after stdout ends, so every reply the engine wrote is dispatched first.
			process.on("close", (code, signal) => {
				this.#alive = false;
				events.onExit(this.#exitReason(code, signal));
				resolve();
			});
		});
	}

	get alive(): boolean {
		return this.#alive;
	}

	write(message: object): void {
		if (!this.#alive || this.#process.stdin.writableEnded) return;
		this.#process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
	}

	/** Ends stdin; the engine exits at EOF. */
	end(): void {
		this.#process.stdin.end();
	}

	kill(): void {
		if (!this.#alive) return;
		this.#alive = false;
		this.#process.kill();
	}

	#recordFailure(failure: string): void {
		this.#failure = this.#failure === "" ? failure : `${this.#failure}; ${failure}`;
	}

	#exitReason(code: number | null, signal: NodeJS.Signals | null): string {
		const failure = this.#failure === "" ? "" : `; ${this.#failure}`;
		const stderr = this.#stderrTail.trim() || "<empty>";
		return `desktop engine exited (code ${code ?? "null"}, signal ${signal ?? "null"})${failure}; stderr: ${stderr}`;
	}
}
