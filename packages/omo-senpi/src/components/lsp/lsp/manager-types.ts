import type { LspClient } from "./client.js";
import type { ResolvedServer } from "./types.js";

export interface ManagedClient {
	root: string;
	serverId: string;
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
