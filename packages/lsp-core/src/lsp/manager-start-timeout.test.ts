import { describe, expect, it } from "bun:test";

import { LspClient } from "./client.js";
import { LspManager } from "./manager.js";
import type { ResolvedServer } from "./types.js";

const server: ResolvedServer = {
	id: "typescript",
	command: ["typescript-language-server"],
	extensions: [".ts"],
	priority: 1,
};

describe("LspManager start timeout", () => {
	it("#given a client whose initialize never settles #when getClient runs #then it rejects fast instead of hanging on INIT_TIMEOUT_MS", async () => {
		// given
		const client = new HangingInitLspClient(server);
		const manager = new LspManager({
			clientFactory: () => client,
			reaperIntervalMs: 60_000,
			startTimeoutMs: 100,
		});

		// when
		const acquisition = manager.getClient("/workspace", server);
		const settled = await settlesWithin(acquisition, 500);

		// then
		try {
			expect(settled).toBe(true);
			await expect(acquisition).rejects.toThrow("LSP start timed out");
			expect(manager.clientCount()).toBe(0);
			expect(client.stopCallCount).toBe(1);
		} finally {
			client.releaseInitialize();
			await acquisition.catch(() => undefined);
			await manager.stopAll();
		}
	});

	it("#given a healthy client #when getClient runs #then it resolves before the start timeout", async () => {
		// given
		const client = new HealthyLspClient(server);
		const manager = new LspManager({
			clientFactory: () => client,
			reaperIntervalMs: 60_000,
		});

		// when
		const acquired = await manager.getClient("/workspace", server);

		// then
		try {
			expect(acquired).toBe(client);
			expect(manager.clientCount()).toBe(1);
		} finally {
			await manager.stopAll();
		}
	});
});

class HangingInitLspClient extends LspClient {
	stopCallCount = 0;
	private releaseInit: (() => void) | undefined;
	private readonly initGate: Promise<void>;

	constructor(resolvedServer: ResolvedServer) {
		super("/workspace", resolvedServer);
		this.initGate = new Promise<void>((resolve) => {
			this.releaseInit = resolve;
		});
	}

	override async start(): Promise<void> {}

	override async initialize(): Promise<void> {
		await this.initGate;
	}

	override async stop(): Promise<void> {
		this.stopCallCount += 1;
	}

	override isAlive(): boolean {
		return true;
	}

	releaseInitialize(): void {
		this.releaseInit?.();
	}
}

class HealthyLspClient extends LspClient {
	override async start(): Promise<void> {}
	override async initialize(): Promise<void> {}
	override async stop(): Promise<void> {}
	override isAlive(): boolean {
		return true;
	}
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise.then(
				() => true,
				() => true,
			),
			new Promise<boolean>((resolve) => {
				timer = setTimeout(() => resolve(false), timeoutMs);
				timer.unref();
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}
