import type { ClientSnapshot, ManagedClient } from "./manager-types.js";

export function ignoreCleanupError(error: unknown): void {
	if (!(error instanceof Error)) throw error;
}

export function clientKey(root: string, serverId: string): string {
	return `${root}::${serverId}`;
}

export function isInitExpired(managed: ManagedClient, now: number, timeoutMs: number): boolean {
	return managed.isInitializing && managed.initializingSince !== null && now - managed.initializingSince > timeoutMs;
}

export function canDeleteOrphaned(managed: ManagedClient): boolean {
	return managed.refCount === 0 && managed.pendingWaiters === 0 && !managed.isInitializing;
}

export function isIdleExpired(managed: ManagedClient, now: number, timeoutMs: number): boolean {
	return canDeleteOrphaned(managed) && now - managed.lastUsedAt > timeoutMs;
}

export function installProcessExitHandler(clients: Map<string, ManagedClient>): () => void {
	const handler = () => {
		for (const managed of clients.values()) {
			try {
				managed.client.stop().catch(ignoreCleanupError);
			} catch (error) {
				if (!(error instanceof Error)) throw error;
			}
		}
		clients.clear();
	};
	process.on("exit", handler);
	return () => {
		process.removeListener("exit", handler);
	};
}

export function toSnapshot(managed: ManagedClient): ClientSnapshot {
	return {
		root: managed.root,
		serverId: managed.serverId,
		refCount: managed.refCount,
		pendingWaiters: managed.pendingWaiters,
		lastUsedAt: managed.lastUsedAt,
		isInitializing: managed.isInitializing,
		alive: managed.client.isAlive(),
		command: managed.client.command(),
	};
}

export async function stopManagedClients(clients: Map<string, ManagedClient>): Promise<void> {
	const stopPromises: Promise<void>[] = [];
	for (const managed of clients.values()) {
		stopPromises.push(managed.client.stop().catch(ignoreCleanupError));
	}
	clients.clear();
	await Promise.allSettled(stopPromises);
}
