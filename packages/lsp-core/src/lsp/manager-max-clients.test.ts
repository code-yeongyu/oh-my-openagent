import { describe, expect, it } from "bun:test";

import type { LspClient } from "./client.js";
import { LspManager } from "./manager.js";
import type { ResolvedServer } from "./types.js";

const SERVER: ResolvedServer = {
	id: "typescript",
	command: ["typescript-language-server", "--stdio"],
	extensions: [".ts"],
	priority: 1,
};

class FakeLspClient {
	alive = true;
	stopCallCount = 0;

	constructor(readonly root: string) {}

	async start(): Promise<void> {}

	async initialize(): Promise<void> {}

	isAlive(): boolean {
		return this.alive;
	}

	command(): string[] {
		return [...SERVER.command];
	}

	async stop(): Promise<void> {
		this.stopCallCount += 1;
		this.alive = false;
	}
}

function managerWithFakes(maxResidentClients: number): {
	readonly manager: LspManager;
	readonly clients: Map<string, FakeLspClient>;
	readonly clock: { value: number };
} {
	const clients = new Map<string, FakeLspClient>();
	const clock = { value: 1_000 };
	const manager = new LspManager({
		maxResidentClients,
		reaperIntervalMs: 60_000,
		idleTimeoutMs: 60_000_000,
		now: () => clock.value,
		clientFactory: (root) => {
			const client = new FakeLspClient(root);
			clients.set(root, client);
			return client as unknown as LspClient;
		},
	});
	return { manager, clients, clock };
}

describe("LspManager resident client cap", () => {
	it("#given a cap of two idle clients #when a third client is admitted #then the least recently used one is stopped and evicted", async () => {
		// given
		const { manager, clients, clock } = managerWithFakes(2);
		try {
			await manager.getClient("/root-a", SERVER);
			manager.releaseClient("/root-a", SERVER.id);
			clock.value += 10;
			await manager.getClient("/root-b", SERVER);
			manager.releaseClient("/root-b", SERVER.id);
			clock.value += 10;

			// when
			await manager.getClient("/root-c", SERVER);
			manager.releaseClient("/root-c", SERVER.id);

			// then
			expect(manager.clientCount()).toBe(2);
			expect(manager.hasClient("/root-a", SERVER.id)).toBe(false);
			expect(manager.hasClient("/root-b", SERVER.id)).toBe(true);
			expect(manager.hasClient("/root-c", SERVER.id)).toBe(true);
			expect(clients.get("/root-a")?.stopCallCount).toBe(1);
		} finally {
			await manager.stopAll();
		}
	});

	it("#given the least recently used client is mid-request #when a new client is admitted #then the busy client survives and an idle one is evicted", async () => {
		// given
		const { manager, clients, clock } = managerWithFakes(2);
		try {
			await manager.getClient("/root-busy", SERVER);
			clock.value += 10;
			await manager.getClient("/root-idle", SERVER);
			manager.releaseClient("/root-idle", SERVER.id);
			clock.value += 10;

			// when
			await manager.getClient("/root-new", SERVER);
			manager.releaseClient("/root-new", SERVER.id);

			// then
			expect(manager.hasClient("/root-busy", SERVER.id)).toBe(true);
			expect(manager.hasClient("/root-idle", SERVER.id)).toBe(false);
			expect(clients.get("/root-busy")?.stopCallCount).toBe(0);
			expect(clients.get("/root-idle")?.stopCallCount).toBe(1);
		} finally {
			manager.releaseClient("/root-busy", SERVER.id);
			await manager.stopAll();
		}
	});

	it("#given every resident client is busy #when a new client is admitted #then nothing is evicted and the cap is exceeded rather than breaking a live request", async () => {
		// given
		const { manager, clients } = managerWithFakes(1);
		try {
			await manager.getClient("/root-busy", SERVER);

			// when
			await manager.getClient("/root-second", SERVER);

			// then
			expect(manager.clientCount()).toBe(2);
			expect(clients.get("/root-busy")?.stopCallCount).toBe(0);
		} finally {
			manager.releaseClient("/root-busy", SERVER.id);
			manager.releaseClient("/root-second", SERVER.id);
			await manager.stopAll();
		}
	});

	it("#given warmup requests beyond the cap #when a warm client is admitted #then the idle least recently used client is evicted too", async () => {
		// given
		const { manager, clients, clock } = managerWithFakes(1);
		try {
			await manager.getClient("/root-first", SERVER);
			manager.releaseClient("/root-first", SERVER.id);
			clock.value += 10;

			// when
			manager.warmupClient("/root-warm", SERVER);
			await Promise.resolve();
			await Promise.resolve();

			// then
			expect(manager.hasClient("/root-first", SERVER.id)).toBe(false);
			expect(clients.get("/root-first")?.stopCallCount).toBe(1);
			expect(manager.hasClient("/root-warm", SERVER.id)).toBe(true);
		} finally {
			await manager.stopAll();
		}
	});
});
