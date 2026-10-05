import { reportBestEffortCleanupError } from "./cleanup-errors.js";
import { LspClient } from "./client.js";
import {
	CLIENT_RESPAWN_COOLDOWN_MS,
	CLIENT_RESPAWN_RETRY_LIMIT,
	IDLE_TIMEOUT_MS,
	INIT_TIMEOUT_MS,
	MAX_RESIDENT_CLIENTS,
	REAPER_INTERVAL_MS,
} from "./constants.js";
import { LspClientRespawnBudgetExceededError } from "./errors.js";
import { installProcessSignalCleanup } from "./process-signal-cleanup.js";
import type { ResolvedServer } from "./types.js";

interface ManagedClient {
	client: LspClient;
	refCount: number;
	pendingWaiters: number;
	lastUsedAt: number;
	initPromise: Promise<void> | null;
	isInitializing: boolean;
	initializingSince: number | null;
}

interface RespawnBudget {
	deadGenerations: number;
	exhaustedAt: number | null;
}

export interface ClientSnapshot {
	root: string;
	serverId: string;
	refCount: number;
	pendingWaiters: number;
	lastUsedAt: number;
	isInitializing: boolean;
	alive: boolean;
	command: string[];
}

export interface LspManagerOptions {
	idleTimeoutMs?: number;
	initTimeoutMs?: number;
	maxResidentClients?: number;
	reaperIntervalMs?: number;
	clientFactory?: (root: string, server: ResolvedServer) => LspClient;
	now?: () => number;
}

async function stopClientBestEffort(client: LspClient): Promise<void> {
	try {
		await client.stop();
	} catch (error) {
		reportBestEffortCleanupError("client stop", error);
	}
}

function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
	if (!signal) return promise;
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const onAbort = () => {
			if (settled) return;
			settled = true;
			reject(new DOMException("Aborted", "AbortError"));
		};
		if (signal.aborted) {
			onAbort();
			return;
		}
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			(value) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(err) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener("abort", onAbort);
				reject(err);
			},
		);
	});
}

export class LspManager {
	private readonly clients = new Map<string, ManagedClient>();
	/** In-flight stops per key; getClient awaits these instead of spawning a duplicate client. */
	private readonly pendingStops = new Map<string, Promise<void>>();
	private readonly respawnBudgets = new Map<string, RespawnBudget>();
	private reaperHandle: NodeJS.Timeout | null = null;
	private signalDisposer: (() => void) | null = null;
	private disposed = false;

	private readonly idleTimeoutMs: number;
	private readonly initTimeoutMs: number;
	private readonly maxResidentClients: number;
	private readonly reaperIntervalMs: number;
	private readonly clientFactory: (root: string, server: ResolvedServer) => LspClient;
	private readonly now: () => number;

	constructor(options: LspManagerOptions = {}) {
		this.idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
		this.initTimeoutMs = options.initTimeoutMs ?? INIT_TIMEOUT_MS;
		this.maxResidentClients = options.maxResidentClients ?? MAX_RESIDENT_CLIENTS;
		this.reaperIntervalMs = options.reaperIntervalMs ?? REAPER_INTERVAL_MS;
		this.clientFactory = options.clientFactory ?? ((root, server) => new LspClient(root, server));
		this.now = options.now ?? (() => Date.now());

		this.startReaper();
		this.signalDisposer = installProcessSignalCleanup(() => this.stopAll());
	}

	private startReaper(): void {
		if (this.reaperHandle) return;
		this.reaperHandle = setInterval(() => {
			this.reapStale();
		}, this.reaperIntervalMs);
		if (typeof this.reaperHandle.unref === "function") {
			this.reaperHandle.unref();
		}
	}

	private getKey(root: string, serverId: string): string {
		return `${root}::${serverId}`;
	}

	/**
	 * Deletes-then-stops with a tombstone: the pending stop is recorded so a concurrent getClient
	 * for the same key awaits it instead of spawning a duplicate client while the old one lingers
	 * (production stops reach ~21s). The tombstone removes itself once the stop settles.
	 */
	private tombstoneStop(key: string, client: LspClient): Promise<void> {
		const stop = stopClientBestEffort(client);
		this.pendingStops.set(key, stop);
		void stop.finally(() => {
			if (this.pendingStops.get(key) === stop) {
				this.pendingStops.delete(key);
			}
		});
		return stop;
	}

	private recordDeadGeneration(key: string): void {
		let budget = this.respawnBudgets.get(key);
		if (budget === undefined) {
			budget = { deadGenerations: 0, exhaustedAt: null };
			this.respawnBudgets.set(key, budget);
		}
		budget.deadGenerations += 1;
	}

	private markHealthyGeneration(key: string): void {
		this.respawnBudgets.delete(key);
	}

	/** Throws while the respawn budget is spent and the cooldown has not elapsed. */
	private ensureRespawnAllowed(key: string, root: string, serverId: string): void {
		const budget = this.respawnBudgets.get(key);
		if (budget === undefined || budget.deadGenerations < CLIENT_RESPAWN_RETRY_LIMIT) return;
		if (budget.exhaustedAt === null) {
			budget.exhaustedAt = this.now();
			throw new LspClientRespawnBudgetExceededError(serverId, root, CLIENT_RESPAWN_RETRY_LIMIT);
		}
		if (this.now() - budget.exhaustedAt < CLIENT_RESPAWN_COOLDOWN_MS) {
			throw new LspClientRespawnBudgetExceededError(serverId, root, CLIENT_RESPAWN_RETRY_LIMIT);
		}
		budget.deadGenerations = 0;
		budget.exhaustedAt = null;
	}

	private reapStale(): void {
		const t = this.now();
		for (const [key, managed] of this.clients) {
			if (
				managed.isInitializing &&
				managed.initializingSince !== null &&
				t - managed.initializingSince > this.initTimeoutMs
			) {
				this.clients.delete(key);
				void this.tombstoneStop(key, managed.client);
				continue;
			}

			if (
				!managed.isInitializing &&
				managed.refCount === 0 &&
				managed.pendingWaiters === 0 &&
				t - managed.lastUsedAt > this.idleTimeoutMs
			) {
				this.clients.delete(key);
				void this.tombstoneStop(key, managed.client);
			}
		}
	}

	/**
	 * Frees capacity for one new client by stopping the least recently used idle client.
	 *
	 * Only clients with no in-flight work are eligible, so a resident server is never torn down
	 * underneath a live request; when every resident client is busy the cap is exceeded instead.
	 */
	private evictForAdmission(): void {
		while (this.clients.size >= this.maxResidentClients) {
			const victim = this.leastRecentlyUsedIdleClient();
			if (!victim) return;
			this.clients.delete(victim.key);
			void this.tombstoneStop(victim.key, victim.managed.client);
		}
	}

	private leastRecentlyUsedIdleClient(): { readonly key: string; readonly managed: ManagedClient } | null {
		let candidate: { readonly key: string; readonly managed: ManagedClient } | null = null;
		for (const [key, managed] of this.clients) {
			if (managed.refCount > 0 || managed.pendingWaiters > 0 || managed.isInitializing) continue;
			if (candidate === null || managed.lastUsedAt < candidate.managed.lastUsedAt) {
				candidate = { key, managed };
			}
		}
		return candidate;
	}

	private async tryDeleteIfOrphaned(key: string, managed: ManagedClient): Promise<void> {
		if (
			managed.refCount === 0 &&
			managed.pendingWaiters === 0 &&
			!managed.isInitializing &&
			this.clients.get(key) === managed
		) {
			this.clients.delete(key);
			await this.tombstoneStop(key, managed.client);
		}
	}

	async getClient(root: string, server: ResolvedServer, signal?: AbortSignal): Promise<LspClient> {
		if (this.disposed) {
			throw new Error("LspManager has been disposed");
		}
		signal?.throwIfAborted();

		const key = this.getKey(root, server.id);
		for (;;) {
			const pendingStop = this.pendingStops.get(key);
			if (pendingStop === undefined) break;
			await awaitWithSignal(pendingStop, signal);
			signal?.throwIfAborted();
		}
		if (this.disposed) {
			throw new Error("LspManager has been disposed");
		}

		let managed = this.clients.get(key);

		if (managed) {
			const t = this.now();
			if (
				managed.isInitializing &&
				managed.initializingSince !== null &&
				t - managed.initializingSince > this.initTimeoutMs
			) {
				this.clients.delete(key);
				await this.tombstoneStop(key, managed.client);
				managed = undefined;
			}
		}

		if (managed) {
			if (managed.initPromise) {
				managed.pendingWaiters++;
				try {
					await awaitWithSignal(managed.initPromise, signal);
				} catch (err) {
					managed.pendingWaiters--;
					await this.tryDeleteIfOrphaned(key, managed);
					throw err;
				}
				managed.pendingWaiters--;
			}

			if (signal?.aborted) {
				await this.tryDeleteIfOrphaned(key, managed);
				signal.throwIfAborted();
			}

			if (!managed.client.isAlive()) {
				this.recordDeadGeneration(key);
				if (this.clients.get(key) === managed) {
					this.clients.delete(key);
				}
				await this.tombstoneStop(key, managed.client);
				return this.getClient(root, server, signal);
			}

			this.markHealthyGeneration(key);
			managed.refCount++;
			managed.lastUsedAt = this.now();
			return managed.client;
		}

		this.evictForAdmission();
		this.ensureRespawnAllowed(key, root, server.id);

		const client = this.clientFactory(root, server);
		const initStartedAt = this.now();
		const initPromise = (async () => {
			await client.start();
			await client.initialize();
		})();

		const newManaged: ManagedClient = {
			client,
			refCount: 0,
			pendingWaiters: 1,
			lastUsedAt: initStartedAt,
			initPromise,
			isInitializing: true,
			initializingSince: initStartedAt,
		};
		this.clients.set(key, newManaged);

		try {
			await awaitWithSignal(initPromise, signal);
		} catch (err) {
			newManaged.pendingWaiters--;
			if (this.clients.get(key) === newManaged) {
				this.clients.delete(key);
			}
			await this.tombstoneStop(key, client);
			throw err;
		}

		newManaged.pendingWaiters--;
		newManaged.isInitializing = false;
		newManaged.initializingSince = null;
		newManaged.initPromise = null;

		if (signal?.aborted) {
			await this.tryDeleteIfOrphaned(key, newManaged);
			signal.throwIfAborted();
		}

		if (!client.isAlive()) {
			this.recordDeadGeneration(key);
			if (this.clients.get(key) === newManaged) {
				this.clients.delete(key);
			}
			await this.tombstoneStop(key, client);
			return this.getClient(root, server, signal);
		}

		this.markHealthyGeneration(key);
		newManaged.refCount++;
		newManaged.lastUsedAt = this.now();
		return client;
	}

	releaseClient(root: string, serverId: string): void {
		const key = this.getKey(root, serverId);
		const managed = this.clients.get(key);
		if (managed && managed.refCount > 0) {
			managed.refCount--;
			managed.lastUsedAt = this.now();
		}
	}

	invalidateClient(root: string, serverId: string, client?: LspClient): void {
		const key = this.getKey(root, serverId);
		const managed = this.clients.get(key);
		if (!managed) return;
		if (client && managed.client !== client) return;
		this.clients.delete(key);
		void this.tombstoneStop(key, managed.client);
	}

	warmupClient(root: string, server: ResolvedServer): void {
		if (this.disposed) return;
		const key = this.getKey(root, server.id);
		if (this.clients.has(key) || this.pendingStops.has(key)) return;

		this.evictForAdmission();
		try {
			this.ensureRespawnAllowed(key, root, server.id);
		} catch {
			return;
		}

		const client = this.clientFactory(root, server);
		const initStartedAt = this.now();
		const initPromise = (async () => {
			await client.start();
			await client.initialize();
		})();

		const managed: ManagedClient = {
			client,
			refCount: 0,
			pendingWaiters: 0,
			lastUsedAt: initStartedAt,
			initPromise,
			isInitializing: true,
			initializingSince: initStartedAt,
		};
		this.clients.set(key, managed);

		initPromise.then(
			() => {
				managed.isInitializing = false;
				managed.initializingSince = null;
				managed.initPromise = null;
				managed.lastUsedAt = this.now();
			},
			() => {
				if (this.clients.get(key) === managed) {
					this.clients.delete(key);
				}
				void this.tombstoneStop(key, client);
			},
		);
	}

	isServerInitializing(root: string, serverId: string): boolean {
		const managed = this.clients.get(this.getKey(root, serverId));
		return managed?.isInitializing ?? false;
	}

	getSnapshot(): ClientSnapshot[] {
		const snapshots: ClientSnapshot[] = [];
		for (const [key, managed] of this.clients) {
			const [root, serverId] = key.split("::") as [string, string];
			snapshots.push({
				root,
				serverId,
				refCount: managed.refCount,
				pendingWaiters: managed.pendingWaiters,
				lastUsedAt: managed.lastUsedAt,
				isInitializing: managed.isInitializing,
				alive: managed.client.isAlive(),
				command: managed.client.command(),
			});
		}
		return snapshots;
	}

	hasClient(root: string, serverId: string): boolean {
		return this.clients.has(this.getKey(root, serverId));
	}

	clientCount(): number {
		return this.clients.size;
	}

	async stopAll(): Promise<void> {
		this.disposed = true;

		if (this.reaperHandle) {
			clearInterval(this.reaperHandle);
			this.reaperHandle = null;
		}

		if (this.signalDisposer) {
			this.signalDisposer();
			this.signalDisposer = null;
		}

		const stopPromises: Promise<void>[] = [];
		for (const managed of this.clients.values()) {
			stopPromises.push(stopClientBestEffort(managed.client));
		}
		const tombstonedStops = [...this.pendingStops.values()];
		this.clients.clear();
		this.respawnBudgets.clear();
		await Promise.allSettled([...stopPromises, ...tombstonedStops]);
		this.pendingStops.clear();
	}
}

let _defaultInstance: LspManager | null = null;

export function getLspManager(): LspManager {
	if (!_defaultInstance) {
		_defaultInstance = new LspManager();
	}
	return _defaultInstance;
}

export async function disposeDefaultLspManager(): Promise<void> {
	if (_defaultInstance) {
		const m = _defaultInstance;
		_defaultInstance = null;
		await m.stopAll();
	}
}
