// A JSON-RPC client for one `senpi-desktop-engine --stdio` process. The driver is the host that
// spawned it, so the host-only methods (`session.open`, `stopPath.*`) are available. Method names and
// error codes are typed by `@oh-my-opencode/senpi-desktop-protocol`, so a protocol rename fails typecheck.
import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
	type EngineMethod,
	type EngineNotification,
	ERROR_CODES,
	type ErrorCode,
} from "@oh-my-opencode/senpi-desktop-protocol";

import { HANG_GUARD_MS } from "./procs.ts";

export const STOP_CHORD = "ctrl+alt+shift+escape";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export type Outcome = "ok" | ErrorCode | `rpc${number}`;

export interface Reply {
	readonly result?: Json;
	readonly error?: { readonly code: number; readonly message: string; readonly data?: Json };
}

export function asObject(value: Json | undefined): JsonObject {
	if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`expected a JSON object, got ${JSON.stringify(value)}`);
	}
	return value;
}

function isErrorCode(value: Json | undefined): value is ErrorCode {
	return ERROR_CODES.some((code) => code === value);
}

/** The engine error code (`error.data.code`), `rpc<code>` for a protocol error, `ok` on success. */
export function outcome(reply: Reply): Outcome {
	if (reply.error === undefined) return "ok";
	const data = reply.error.data;
	if (data !== null && typeof data === "object" && !Array.isArray(data) && isErrorCode(data.code)) {
		return data.code;
	}
	return `rpc${reply.error.code}`;
}

interface Pending {
	readonly resolve: (reply: Reply) => void;
	readonly timer: ReturnType<typeof setTimeout>;
}

export class Engine {
	readonly notifications: { readonly method: EngineNotification | string; readonly params: Json }[] = [];
	private readonly pending = new Map<number, Pending>();
	private readonly exited: Promise<number | null>;
	private stderr = "";
	private nextId = 1;

	private constructor(private readonly child: ChildProcess) {
		this.exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
		child.once("error", (error) => {
			this.stderr += `spawn: ${error.message}`;
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			this.stderr += chunk.toString("utf8");
		});
		if (child.stdout !== null) {
			createInterface({ input: child.stdout }).on("line", (line) => this.receive(line));
		}
		child.once("exit", () => {
			for (const [id, pending] of this.pending) {
				clearTimeout(pending.timer);
				pending.resolve({ error: { code: -32000, message: `engine exited before answering #${id}` } });
			}
			this.pending.clear();
		});
	}

	static spawn(binary: string, env: NodeJS.ProcessEnv): Engine {
		return new Engine(spawn(binary, ["--stdio"], { env, stdio: ["pipe", "pipe", "pipe"] }));
	}

	get pid(): number {
		return this.child.pid ?? 0;
	}

	private receive(line: string): void {
		if (line.trim() === "") return;
		const parsed: Json = JSON.parse(line);
		const message = asObject(parsed);
		if (typeof message.id === "number") {
			const pending = this.pending.get(message.id);
			if (pending === undefined) return;
			this.pending.delete(message.id);
			clearTimeout(pending.timer);
			const error = message.error === undefined ? undefined : asObject(message.error);
			pending.resolve(
				error === undefined
					? { result: message.result ?? null }
					: { error: { code: Number(error.code), message: String(error.message), data: error.data ?? null } },
			);
		} else if (typeof message.method === "string") {
			this.notifications.push({ method: message.method, params: message.params ?? null });
		}
	}

	call(method: EngineMethod, params: JsonObject = {}): Promise<Reply> {
		const id = this.nextId++;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				resolve({ error: { code: -32000, message: `hang guard: ${method} unanswered after ${HANG_GUARD_MS} ms` } });
			}, HANG_GUARD_MS);
			this.pending.set(id, { resolve, timer });
			this.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
		});
	}

	async result(method: EngineMethod, params: JsonObject = {}): Promise<Json> {
		const reply = await this.call(method, params);
		if (reply.error !== undefined) throw new Error(`${method} failed: ${outcome(reply)} ${reply.error.message}`);
		return reply.result ?? null;
	}

	/** Opens the session the way the host does after activation, then arms the stop paths. */
	async activate(allowHostRelayOnlyStop: boolean): Promise<JsonObject> {
		await this.result("session.open", { allowHostRelayOnlyStop });
		return asObject(await this.result("stopPath.start", { chord: STOP_CHORD }));
	}

	/** One mutating request after the heartbeat that keeps the host-relay stop path fresh. */
	async exec(method: EngineMethod, params: JsonObject): Promise<Reply> {
		await this.call("stopPath.heartbeat");
		return this.call(method, params);
	}

	async close(): Promise<string> {
		if (this.child.exitCode === null) {
			await this.call("session.close");
			this.child.stdin?.end();
		}
		const timer = setTimeout(() => this.child.kill("SIGKILL"), HANG_GUARD_MS);
		const code = await this.exited;
		clearTimeout(timer);
		const stderr = this.stderr.trim();
		return `engine pid ${this.pid} exited ${code}${stderr === "" ? "" : ` stderr=${JSON.stringify(stderr.slice(-400))}`}`;
	}
}
