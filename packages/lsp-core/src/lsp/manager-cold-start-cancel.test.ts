import { describe, expect, it } from "bun:test";

import type { LspClient } from "./client.js";
import { LspManager } from "./manager.js";
import type { ResolvedServer } from "./types.js";

const SERVER: ResolvedServer = {
	id: "kotlin",
	command: ["kotlin-lsp", "--stdio"],
	extensions: [".kt"],
	priority: 1,
};
const ROOT = "/workspace/app";

interface Deferred {
	readonly promise: Promise<void>;
	resolve(): void;
	reject(error: Error): void;
}

function deferred(): Deferred {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

class SlowColdStartClient {
	readonly initialized = deferred();
	readonly initializeStarted = deferred();
	readonly stopped = deferred();
	alive = true;
	stopCallCount = 0;

	async start(): Promise<void> {}

	async initialize(): Promise<void> {
		this.initializeStarted.resolve();
		await this.initialized.promise;
	}

	isAlive(): boolean {
		return this.alive;
	}

	async stop(): Promise<void> {
		this.stopCallCount += 1;
		this.alive = false;
		this.stopped.resolve();
	}
}

function setup(): { manager: LspManager; spawned: SlowColdStartClient[] } {
	const spawned: SlowColdStartClient[] = [];
	const manager = new LspManager({
		reaperIntervalMs: 60_000,
		clientFactory: () => {
			const client = new SlowColdStartClient();
			if (spawned.length > 0) client.initialized.resolve();
			spawned.push(client);
			return client as unknown as LspClient;
		},
	});
	return { manager, spawned };
}

async function abortedFirstCaller(manager: LspManager, spawned: SlowColdStartClient[]): Promise<SlowColdStartClient> {
	const controller = new AbortController();
	const first = manager.getClient(ROOT, SERVER, controller.signal);
	const client = spawned[0];
	if (client === undefined) throw new Error("no client spawned");
	await client.initializeStarted.promise;
	controller.abort();
	await expect(first).rejects.toHaveProperty("name", "AbortError");
	return client;
}

describe("LspManager cold start outliving its first caller (senpi#4208)", () => {
	it("#given a cold start slower than the first caller #when that caller aborts #then the server keeps starting instead of being stopped", async () => {
		const { manager, spawned } = setup();
		try {
			const client = await abortedFirstCaller(manager, spawned);

			expect(client.stopCallCount).toBe(0);
			expect(manager.clientCount()).toBe(1);
		} finally {
			await manager.stopAll();
		}
	});

	it("#given the first caller aborted #when the next caller arrives during the start #then it attaches to the same start and gets the warm server", async () => {
		const { manager, spawned } = setup();
		try {
			const client = await abortedFirstCaller(manager, spawned);

			const second = manager.getClient(ROOT, SERVER);
			client.initialized.resolve();

			expect(await second).toBe(client as unknown as LspClient);
			expect(spawned).toHaveLength(1);
			expect(client.stopCallCount).toBe(0);
		} finally {
			await manager.stopAll();
		}
	});

	it("#given the first caller aborted #when the start finishes before anyone else asks #then the next caller reuses the warm server", async () => {
		const { manager, spawned } = setup();
		try {
			const client = await abortedFirstCaller(manager, spawned);
			client.initialized.resolve();
			await client.initialized.promise;

			expect(await manager.getClient(ROOT, SERVER)).toBe(client as unknown as LspClient);
			expect(spawned).toHaveLength(1);
		} finally {
			await manager.stopAll();
		}
	});

	it("#given the first caller aborted #when the start then fails #then the server is stopped once and the next caller starts a fresh one", async () => {
		const { manager, spawned } = setup();
		try {
			const client = await abortedFirstCaller(manager, spawned);
			client.initialized.reject(new Error("initialize failed"));
			await client.stopped.promise;

			const next = await manager.getClient(ROOT, SERVER);

			expect(next).toBe(spawned[1] as unknown as LspClient);
			expect(client.stopCallCount).toBe(1);
			expect(spawned).toHaveLength(2);
		} finally {
			await manager.stopAll();
		}
	});
});
