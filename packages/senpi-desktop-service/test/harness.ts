import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import type { ChildFactory } from "../src/service/child";

const fakeEngine = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-engine.mjs");
const RECEIVED = "recv ";

/** A request as the fake engine received it, with the index of the child that received it. */
export interface WireRequest {
	readonly child: number;
	readonly id?: number;
	readonly method: string;
	readonly params?: unknown;
}

interface Waiter {
	readonly method: string;
	readonly n: number;
	readonly resolve: (request: WireRequest) => void;
}

/** Every child the factory spawned, the requests they received, and how often the service killed one. */
export interface SpawnLog {
	readonly factory: ChildFactory;
	/** The same spawn as `factory`, synchronously, for callers that need the child itself. */
	readonly spawn: () => ChildProcessWithoutNullStreams;
	readonly children: readonly ChildProcessWithoutNullStreams[];
	readonly requests: readonly WireRequest[];
	readonly kills: () => number;
	/** Resolves once the fake engine received the n-th (1-based) request named `method`. */
	readonly nthRequest: (method: string, n: number) => Promise<WireRequest>;
}

function receivedRequest(line: string, child: number): WireRequest | undefined {
	const message: unknown = JSON.parse(line);
	if (typeof message !== "object" || message === null || !("method" in message) || !("params" in message)) {
		return undefined;
	}
	const { method, params } = message;
	if (method !== "engine.log" || typeof params !== "object" || params === null || !("message" in params)) {
		return undefined;
	}
	const text = params.message;
	if (typeof text !== "string" || !text.startsWith(RECEIVED)) return undefined;
	const request: { id?: number; method: string; params?: unknown } = JSON.parse(text.slice(RECEIVED.length));
	return { child, ...request };
}

/** Spawns `test/fake-engine.mjs` through the current `node`, observing its wire echo and `kill` calls. */
export function fakeEngineFactory(env: Readonly<Record<string, string>> = {}): SpawnLog {
	const children: ChildProcessWithoutNullStreams[] = [];
	const requests: WireRequest[] = [];
	const waiters: Waiter[] = [];
	const kills: { readonly calls: () => number }[] = [];
	const record = (request: WireRequest) => {
		requests.push(request);
		const count = requests.filter((seen) => seen.method === request.method).length;
		for (const waiter of waiters) {
			if (waiter.method === request.method && waiter.n === count) waiter.resolve(request);
		}
	};
	const spawnChild = (): ChildProcessWithoutNullStreams => {
		const index = children.length;
		const child = spawn(process.execPath, [fakeEngine, "--stdio"], {
			env: { ...process.env, ...env },
			stdio: "pipe",
		});
		const kill = vi.spyOn(child, "kill");
		kills.push({ calls: () => kill.mock.calls.length });
		createInterface({ input: child.stdout }).on("line", (line) => {
			const request = receivedRequest(line, index);
			if (request !== undefined) record(request);
		});
		children.push(child);
		return child;
	};
	const nthRequest = (method: string, n: number) => {
		const found = requests.filter((seen) => seen.method === method)[n - 1];
		if (found !== undefined) return Promise.resolve(found);
		return new Promise<WireRequest>((resolve) => waiters.push({ method, n, resolve }));
	};
	const totalKills = () => kills.reduce((sum, spy) => sum + spy.calls(), 0);
	return { factory: spawnChild, spawn: spawnChild, children, requests, kills: totalKills, nthRequest };
}

/** Resolves when `child` has exited. */
export function exitOf(child: ChildProcessWithoutNullStreams | undefined): Promise<void> {
	if (child === undefined) return Promise.reject(new Error("no child was spawned"));
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
	return new Promise((resolve) => child.once("close", () => resolve()));
}

export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("expected the promise to reject");
}
