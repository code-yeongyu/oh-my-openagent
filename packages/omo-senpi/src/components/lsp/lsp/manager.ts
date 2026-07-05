import { LspClient } from "./client.js";
import { IDLE_TIMEOUT_MS, INIT_TIMEOUT_MS, REAPER_INTERVAL_MS } from "./constants.js";
import {
	canDeleteOrphaned,
	clientKey,
	ignoreCleanupError,
	installProcessExitHandler,
	isIdleExpired,
	isInitExpired,
	stopManagedClients,
	toSnapshot,
} from "./manager-lifecycle.js";
import type { ClientSnapshot, LspManagerOptions, ManagedClient } from "./manager-types.js";
import { awaitWithSignal } from "./manager-wait.js";
import type { ResolvedServer } from "./types.js";

export type { ClientSnapshot, LspManagerOptions } from "./manager-types.js";

export class LspManager {
	private readonly clients = new Map<string, ManagedClient>();
	private reaperHandle: NodeJS.Timeout | null = null;
	private exitDisposer: (() => void) | null = null;
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
		this.installProcessExitHandler();
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

	private installProcessExitHandler(): void {
		this.exitDisposer = installProcessExitHandler(this.clients);
	}

	private getKey(root: string, serverId: string): string {
		return clientKey(root, serverId);
	}

	private reapStale(): void {
		const t = this.now();
		for (const [key, managed] of this.clients) {
			if (isInitExpired(managed, t, this.initTimeoutMs)) {
				managed.client.stop().catch(ignoreCleanupError);
				this.clients.delete(key);
				continue;
			}

			if (isIdleExpired(managed, t, this.idleTimeoutMs)) {
				managed.client.stop().catch(ignoreCleanupError);
				this.clients.delete(key);
			}
		}
	}

	private async tryDeleteIfOrphaned(key: string, managed: ManagedClient): Promise<void> {
		if (canDeleteOrphaned(managed) && this.clients.get(key) === managed) {
			this.clients.delete(key);
			await managed.client.stop().catch(ignoreCleanupError);
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
			if (isInitExpired(managed, t, this.initTimeoutMs)) {
				await managed.client.stop().catch(ignoreCleanupError);
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
				await managed.client.stop().catch(ignoreCleanupError);
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
			root,
			serverId: server.id,
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
			await client.stop().catch(ignoreCleanupError);
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
		managed.client.stop().catch(ignoreCleanupError);
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
			root,
			serverId: server.id,
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
				client.stop().catch(ignoreCleanupError);
			},
		);
	}

	isServerInitializing(root: string, serverId: string): boolean {
		const managed = this.clients.get(this.getKey(root, serverId));
		return managed?.isInitializing ?? false;
	}

	getSnapshot(): ClientSnapshot[] {
		const snapshots: ClientSnapshot[] = [];
		for (const managed of this.clients.values()) {
			snapshots.push(toSnapshot(managed));
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

		if (this.exitDisposer) {
			this.exitDisposer();
			this.exitDisposer = null;
		}

		await stopManagedClients(this.clients);
	}
}
