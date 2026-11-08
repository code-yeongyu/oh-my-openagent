import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { locateDesktopEngine } from "../../src/locator";

/** Bounds every wait; a hang guard only, no assertion depends on latency. */
export const HANG_GUARD_MS = 30_000;
/** Vitest's per-test deadline sits above the hang guard so the guard reports first. */
export const TEST_TIMEOUT_MS = HANG_GUARD_MS + 15_000;
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const TWO_DISPLAYS = path.join(
	REPO_ROOT,
	"crates",
	"senpi-desktop-backend-fake",
	"fixtures",
	"two-displays-one-window.json",
);
export const CHORD = "ctrl+alt+shift+escape";

const ENGINE_ENV = [
	"SENPI_DESKTOP_BACKEND",
	"SENPI_DESKTOP_FAKE_CLOCK",
	"SENPI_DESKTOP_OPERATION_TIMEOUT_MS",
	"SENPI_DESKTOP_CLOSE_TIMEOUT_MS",
] as const;

export type Message = Readonly<Record<string, unknown>>;

export function isMessage(value: unknown): value is Message {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The member at `keys` below `value`, or `undefined`. */
export function at(value: unknown, ...keys: readonly string[]): unknown {
	let current = value;
	for (const key of keys) {
		if (!isMessage(current)) return undefined;
		current = current[key];
	}
	return current;
}

function parseMessage(text: string): Message {
	const parsed: unknown = JSON.parse(text);
	if (!isMessage(parsed)) throw new Error(`not a JSON object: ${text}`);
	return parsed;
}

/** `data.code` of an error reply. */
export function errorCode(reply: Message): unknown {
	return at(reply, "error", "data", "code");
}

/** The engine binary the production locator resolves on this host; a miss fails the suite, never skips it. */
export function locatedEngine(): string {
	const location = locateDesktopEngine();
	if (location.path === null) {
		throw new Error(`${location.diagnostic.message} ${location.diagnostic.cause}`);
	}
	return location.path;
}

/** One `--stdio` engine process speaking NDJSON JSON-RPC. */
export class EngineProcess {
	readonly #child: ChildProcessWithoutNullStreams;
	readonly #inbox: Message[] = [];
	readonly #waiters: Array<(message: Message | undefined) => void> = [];
	readonly #exited: Promise<number | null>;
	#closed = false;
	#nextId = 1000;

	/** Spawns the located engine in `args`' mode with exactly `env` among the engine's variables. */
	constructor(env: Readonly<Record<string, string>>, args: readonly string[] = ["--stdio"]) {
		const inherited = { ...process.env };
		for (const name of ENGINE_ENV) delete inherited[name];
		this.#child = spawn(locatedEngine(), [...args], { env: { ...inherited, ...env }, windowsHide: true });
		this.#child.stderr.resume();
		createInterface({ input: this.#child.stdout }).on("line", (line) => {
			const message = parseMessage(line);
			const waiter = this.#waiters.shift();
			if (waiter === undefined) this.#inbox.push(message);
			else waiter(message);
		});
		this.#exited = new Promise((resolve) => {
			this.#child.on("close", (code) => {
				this.#closed = true;
				for (const waiter of this.#waiters.splice(0)) waiter(undefined);
				resolve(code);
			});
		});
	}

	send(message: Message): void {
		this.#child.stdin.write(`${JSON.stringify(message)}\n`);
	}

	request(id: number | string, method: string, params: unknown): void {
		this.send({ jsonrpc: "2.0", id, method, params });
	}

	/** The next output line; `undefined` once the engine exited. */
	nextOrEnd(): Promise<Message | undefined> {
		const queued = this.#inbox.shift();
		if (queued !== undefined) return Promise.resolve(queued);
		if (this.#closed) return Promise.resolve(undefined);
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("engine output hang guard expired")), HANG_GUARD_MS);
			this.#waiters.push((message) => {
				clearTimeout(timer);
				resolve(message);
			});
		});
	}

	async next(): Promise<Message> {
		const message = await this.nextOrEnd();
		if (message === undefined) throw new Error("engine exited before the expected message");
		return message;
	}

	/** Sends a request with the next free id and returns its reply, skipping notifications. */
	async call(method: string, params: unknown = {}): Promise<Message> {
		this.#nextId += 1;
		const id = this.#nextId;
		this.request(id, method, params);
		for (;;) {
			const message = await this.next();
			if ("id" in message) {
				if (message.id !== id) throw new Error(`reply to ${method} carried id ${String(message.id)}`);
				return message;
			}
		}
	}

	/** Reads until `found` matches; every message in arrival order. */
	async readUntil(found: (message: Message) => boolean): Promise<readonly Message[]> {
		const seen: Message[] = [];
		for (let message = await this.next(); ; message = await this.next()) {
			seen.push(message);
			if (found(message)) return seen;
		}
	}

	/** Ends stdin and returns every line written before the engine exits. */
	async drain(): Promise<readonly Message[]> {
		this.#child.stdin.end();
		const rest: Message[] = [];
		for (let message = await this.nextOrEnd(); message !== undefined; message = await this.nextOrEnd()) {
			rest.push(message);
		}
		return rest;
	}

	/** Ends stdin and resolves the exit code. */
	finish(): Promise<number | null> {
		this.#child.stdin.end();
		return this.#exited;
	}

	/** Stops a process a test is done with, even one stuck in a delayed backend call. */
	kill(): void {
		if (!this.#closed) this.#child.kill();
	}
}

/** Per-suite temp scenarios: the two-display fixture with top-level keys replaced. */
export class Scenarios {
	readonly #dir = mkdtempSync(path.join(tmpdir(), "senpi-desktop-engine-scenarios-"));
	#count = 0;

	twoDisplaysWith(overlay: Readonly<Record<string, unknown>>): string {
		const base = parseMessage(readFileSync(TWO_DISPLAYS, "utf8"));
		this.#count += 1;
		const file = path.join(this.#dir, `scenario-${this.#count}.json`);
		writeFileSync(file, JSON.stringify({ ...base, ...overlay }));
		return file;
	}

	remove(): void {
		rmSync(this.#dir, { recursive: true, force: true });
	}
}

/** An engine over the fake scenario at `scenario`, under the fake clock, plus `env`. */
export function headless(scenario: string, env: Readonly<Record<string, string>> = {}): EngineProcess {
	return new EngineProcess({ SENPI_DESKTOP_BACKEND: `fake:${scenario}`, SENPI_DESKTOP_FAKE_CLOCK: "1", ...env });
}

/** What the host does after activation (todo 12): open under the host-relay policy, arm the relay, beat once. */
export async function makeStopPathLive(engine: EngineProcess): Promise<void> {
	await engine.call("session.open", { allowHostRelayOnlyStop: true });
	const started = await engine.call("stopPath.start", { chord: CHORD });
	if (at(started, "result", "hostRelayLive") !== true) throw new Error(`stopPath.start: ${JSON.stringify(started)}`);
	await engine.call("stopPath.heartbeat");
}

/** Captures `target` and returns the frame id. */
export async function capture(engine: EngineProcess, target: string): Promise<string> {
	const captured = await engine.call("capture", { target, caps: { maxWidth: 320 } });
	const frameId = at(captured, "result", "frameId");
	if (typeof frameId !== "string") throw new Error(`capture of ${target} failed: ${JSON.stringify(captured)}`);
	return frameId;
}

/** Snapshots window `target` and returns the ref of the first line containing `label`. */
export async function snapshotRef(engine: EngineProcess, target: string, label: string): Promise<string> {
	const snapshot = await engine.call("ax.snapshot", { target });
	const text = at(snapshot, "result", "text");
	const line = typeof text === "string" ? text.split("\n").find((candidate) => candidate.includes(label)) : undefined;
	const ref = line?.split("[ref=")[1]?.split("]")[0];
	if (ref === undefined) throw new Error(`no ref for ${label} in ${JSON.stringify(snapshot)}`);
	return ref;
}
