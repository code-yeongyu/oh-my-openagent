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

/** Simulates a stop that lingers (production stops reach ~21s), which is the behavior under test. */
const SLOW_STOP_MS = 50;

interface RecordingClientOptions {
	readonly stopDelayMs: number;
	readonly initializeError?: Error;
	readonly alive: boolean;
}

class RecordingFakeClient {
	alive: boolean;
	stopCallCount = 0;

	constructor(
		readonly root: string,
		private readonly log: EventLog,
		private readonly options: RecordingClientOptions,
	) {
		this.alive = options.alive;
	}

	async start(): Promise<void> {
		this.log.push(`spawn:${this.root}`);
	}

	async initialize(): Promise<void> {
		if (this.options.initializeError !== undefined) {
			throw this.options.initializeError;
		}
	}

	isAlive(): boolean {
		return this.alive;
	}

	command(): string[] {
		return [...SERVER.command];
	}

	async stop(): Promise<void> {
		this.stopCallCount += 1;
		this.log.push(`stop-start:${this.root}`);
		await delay(this.options.stopDelayMs);
		this.alive = false;
		this.log.push(`stop-end:${this.root}`);
	}
}

class EventLog {
	readonly entries: string[] = [];
	private waiters: Array<{ readonly event: string; readonly resolve: () => void }> = [];

	push(event: string): void {
		this.entries.push(event);
		const due = this.waiters.filter((waiter) => waiter.event === event);
		if (due.length === 0) return;
		this.waiters = this.waiters.filter((waiter) => waiter.event !== event);
		for (const waiter of due) waiter.resolve();
	}

	waitFor(event: string): Promise<void> {
		if (this.entries.includes(event)) return Promise.resolve();
		return new Promise<void>((resolve) => {
			this.waiters.push({ event, resolve });
		});
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

interface HarnessOptions {
	readonly maxResidentClients?: number;
	readonly stopDelayMs?: number;
	/** Leading generations whose initialize() rejects; later generations start cleanly. */
	readonly initializeFailures?: number;
	/** Generations at or above this index report alive; earlier ones emulate a crash-looping server. */
	readonly aliveFromGeneration?: number;
}

function managerHarness(options: HarnessOptions = {}): {
	readonly manager: LspManager;
	readonly clients: RecordingFakeClient[];
	readonly log: EventLog;
	readonly clock: { value: number };
} {
	const clients: RecordingFakeClient[] = [];
	const log = new EventLog();
	const clock = { value: 1_000 };
	const generations = new Map<string, number>();
	const aliveFrom = options.aliveFromGeneration ?? 1;
	const stopDelayMs = options.stopDelayMs ?? 0;
	const initializeFailures = options.initializeFailures ?? 0;
	const manager = new LspManager({
		maxResidentClients: options.maxResidentClients ?? 6,
		reaperIntervalMs: 60_000,
		idleTimeoutMs: 60_000_000,
		now: () => clock.value,
		clientFactory: (root) => {
			const generation = (generations.get(root) ?? 0) + 1;
			generations.set(root, generation);
			const client = new RecordingFakeClient(root, log, {
				stopDelayMs,
				alive: generation >= aliveFrom,
				...(generation <= initializeFailures ? { initializeError: new Error("initialize boom") } : {}),
			});
			clients.push(client);
			return client as unknown as LspClient;
		},
	});
	return { manager, clients, log, clock };
}

describe("LspManager pending-stop tombstones", () => {
	it("#given a slow-stopping client evicted at the resident cap #when the evicted root is re-acquired while the stop is pending #then the replacement spawns only after the old client stopped", async () => {
		// given
		const { manager, log } = managerHarness({ maxResidentClients: 1, stopDelayMs: SLOW_STOP_MS });
		try {
			await manager.getClient("/root-a", SERVER);
			manager.releaseClient("/root-a", SERVER.id);

			// when: admitting root-b synchronously evicts idle root-a (void stop), and root-a is
			// re-acquired in the same window while the evicted client's stop is still pending.
			const rootBPromise = manager.getClient("/root-b", SERVER);
			const rootAPromise = manager.getClient("/root-a", SERVER);
			await Promise.all([rootBPromise, rootAPromise]);
			manager.releaseClient("/root-b", SERVER.id);
			manager.releaseClient("/root-a", SERVER.id);

			// then
			expect(log.entries.filter((event) => event.endsWith("/root-a"))).toEqual([
				"spawn:/root-a",
				"stop-start:/root-a",
				"stop-end:/root-a",
				"spawn:/root-a",
			]);
		} finally {
			await manager.stopAll();
		}
	});

	it("#given an invalidated client whose stop is still pending #when the same root is re-acquired #then the replacement spawns only after the invalidated client stopped", async () => {
		// given
		const { manager, log } = managerHarness({ stopDelayMs: SLOW_STOP_MS });
		try {
			await manager.getClient("/root-a", SERVER);
			manager.releaseClient("/root-a", SERVER.id);

			// when
			manager.invalidateClient("/root-a", SERVER.id);
			await manager.getClient("/root-a", SERVER);

			// then
			expect(log.entries).toEqual([
				"spawn:/root-a",
				"stop-start:/root-a",
				"stop-end:/root-a",
				"spawn:/root-a",
			]);
		} finally {
			await manager.stopAll();
		}
	});

	it("#given a client whose initialization failed while its stop is pending #when another getClient races the stop #then the replacement spawns only after the failed client stopped", async () => {
		// given
		const { manager, log } = managerHarness({
			stopDelayMs: SLOW_STOP_MS,
			initializeFailures: 1,
		});
		try {
			const failing = manager.getClient("/root-fail", SERVER);

			// when: the second acquisition starts once the first one's stop is provably in flight.
			await log.waitFor("stop-start:/root-fail");
			const racing = manager.getClient("/root-fail", SERVER);
			await expect(failing).rejects.toThrow("initialize boom");
			await racing;
			manager.releaseClient("/root-fail", SERVER.id);

			// then
			expect(log.entries).toEqual([
				"spawn:/root-fail",
				"stop-start:/root-fail",
				"stop-end:/root-fail",
				"spawn:/root-fail",
			]);
		} finally {
			await manager.stopAll();
		}
	});
});

describe("LspManager dead-client respawn budget", () => {
	it("#given a crash-looping client that is dead on every acquisition #when getClient is called repeatedly #then respawn attempts stay within the retry budget", async () => {
		// given
		const { manager, clients } = managerHarness({ aliveFromGeneration: Number.POSITIVE_INFINITY });
		try {
			// when
			for (let attempt = 0; attempt < 8; attempt += 1) {
				await manager
					.getClient("/root-crash", SERVER)
					.then(
						() => manager.releaseClient("/root-crash", SERVER.id),
						() => undefined,
					);
			}

			// then: one initial generation plus at most two budgeted respawns.
			expect(clients.length).toBeLessThanOrEqual(3);
		} finally {
			await manager.stopAll();
		}
	});

	it("#given the respawn budget is exhausted #when getClient is called again #then it rejects with a budget error instead of respawning", async () => {
		// given
		const { manager } = managerHarness({ aliveFromGeneration: Number.POSITIVE_INFINITY });
		try {
			await expect(manager.getClient("/root-crash", SERVER)).rejects.toThrow(/respawn budget/);

			// when / then
			await expect(manager.getClient("/root-crash", SERVER)).rejects.toThrow(/respawn budget/);
		} finally {
			await manager.stopAll();
		}
	});

	it("#given the budget was exhausted but the cooldown elapsed and the server recovered #when getClient is called #then it spawns again and resets the budget on a healthy generation", async () => {
		// given: generations one and two crash, the third is healthy.
		const { manager, clients, clock } = managerHarness({ aliveFromGeneration: 3 });
		try {
			await expect(manager.getClient("/root-crash", SERVER)).rejects.toThrow(/respawn budget/);

			// when: cooldown elapses (60s default) and the server stays alive again.
			clock.value += 60_001;
			const recovered = await manager.getClient("/root-crash", SERVER);
			manager.releaseClient("/root-crash", SERVER.id);

			// then
			expect(clients.length).toBe(3);
			await expect(manager.getClient("/root-crash", SERVER)).resolves.toBe(recovered);
			manager.releaseClient("/root-crash", SERVER.id);
		} finally {
			await manager.stopAll();
		}
	});
});
