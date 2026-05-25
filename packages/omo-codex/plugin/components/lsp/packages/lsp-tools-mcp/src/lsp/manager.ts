import { reportBestEffortCleanupError } from "./cleanup-errors.js";
import { LspClient } from "./client.js";
import { IDLE_TIMEOUT_MS, INIT_TIMEOUT_MS, REAPER_INTERVAL_MS } from "./constants.js";
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
	private reaperHandle: NodeJS.Timeout | null = null;
	private signalDisposer: (() => void) | null = null;
	private disposed = false;

	private readonly idleTimeoutMs: number;
	private readonly initTimeoutMs: number;
	private readonly reaperIntervalMs: number;
	private readonly clientFactory: (root: string, server: ResolvedServer) => LspClient;
	private readonly now: () => number;

	constructor(options: LspManagerOptions = {}) {
		this.idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
		this.initTimeoutMs = options.initTimeoutMs ?? INIT_TIMEOUT_MS;
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

	private reapStale(): void {
		const t = this.now();
		for (const [key, managed] of this.clients) {
			if (
				managed.isInitializing &&
				managed.initializingSince !== null &&
				t - managed.initializingSince > this.initTimeoutMs
			) {
				void stopClientBestEffort(managed.client);
				this.clients.delete(key);
				continue;
			}

			if (
				!managed.isInitializing &&
				managed.refCount === 0 &&
				managed.pendingWaiters === 0 &&
				t - managed.lastUsedAt > this.idleTimeoutMs
			) {
				void stopClientBestEffort(managed.client);
				this.clients.delete(key);
			}
		}
	}

	private async tryDeleteIfOrphaned(key: string, managed: ManagedClient): Promise<void> {
		if (
			managed.refCount === 0 &&
			managed.pendingWaiters === 0 &&
			!managed.isInitializing &&
			this.clients.get(key) === managed
		) {
			this.clients.delete(key);
			await stopClientBestEffort(managed.client);
		}
	}

	async getClient(root: string, server: ResolvedServer, signal?: AbortSignal): Promise<LspClient> {
		if (this.disposed) {
			throw new Error("LspManager has been disposed");
		}
		signal?.throwIfAborted();

		const key = this.getKey(root, server.id);
		let managed = this.clients.get(key);

		if (managed) {
			const t = this.now();
			if (
				managed.isInitializing &&
				managed.initializingSince !== null &&
				t - managed.initializingSince > this.initTimeoutMs
			) {
				await stopClientBestEffort(managed.client);
				this.clients.delete(key);
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
				await stopClientBestEffort(managed.client);
				this.clients.delete(key);
				return this.getClient(root, server, signal);
			}

			managed.refCount++;
			managed.lastUsedAt = this.now();
			return managed.client;
		}

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
			await stopClientBestEffort(client);
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
		void stopClientBestEffort(managed.client);
	}

	warmupClient(root: string, server: ResolvedServer): void {
		if (this.disposed) return;
		const key = this.getKey(root, server.id);
		if (this.clients.has(key)) return;

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
				void stopClientBestEffort(client);
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
		this.clients.clear();
		await Promise.allSettled(stopPromises);
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
