import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { CONFIG_DIR_NAME, getAgentDir } from "../../../../config.ts";
import { emptyHookTrustState, type HookTrustStorageScope, readHookTrustStateJson } from "./trust.ts";
import type { HookTrustEntry, HookTrustState } from "./types.ts";

export interface HookStateStorage {
	read(scope: HookTrustStorageScope): HookTrustState;
	update(scope: HookTrustStorageScope, updater: (current: HookTrustState) => HookTrustState): HookTrustState;
}

export type FileHookStateStorageOptions = {
	readonly agentDir?: string;
	readonly cwd: string;
};

export class FileHookStateStorage implements HookStateStorage {
	private readonly globalStatePath: string;
	private readonly projectStatePath: string;

	constructor(options: FileHookStateStorageOptions) {
		const agentDir = options.agentDir ?? getAgentDir();
		this.globalStatePath = join(agentDir, "hooks-state.json");
		this.projectStatePath = join(options.cwd, CONFIG_DIR_NAME, "hooks-state.json");
	}

	read(scope: HookTrustStorageScope): HookTrustState {
		return withHookStateFileLock(statePathForScope(scope, this.globalStatePath, this.projectStatePath), (path) =>
			readHookTrustStateJson(existsSync(path) ? readFileSync(path, "utf-8") : undefined),
		);
	}

	update(scope: HookTrustStorageScope, updater: (current: HookTrustState) => HookTrustState): HookTrustState {
		return withHookStateFileLock(statePathForScope(scope, this.globalStatePath, this.projectStatePath), (path) => {
			const current = readHookTrustStateJson(existsSync(path) ? readFileSync(path, "utf-8") : undefined);
			const next = updater(current);
			writeFileSync(path, serializeHookTrustState(next), "utf-8");
			return next;
		});
	}
}

export class InMemoryHookStateStorage implements HookStateStorage {
	private globalState: HookTrustState = emptyHookTrustState();
	private projectState: HookTrustState = emptyHookTrustState();

	read(scope: HookTrustStorageScope): HookTrustState {
		return scope === "global" ? this.globalState : this.projectState;
	}

	update(scope: HookTrustStorageScope, updater: (current: HookTrustState) => HookTrustState): HookTrustState {
		const next = updater(this.read(scope));
		if (scope === "global") {
			this.globalState = next;
		} else {
			this.projectState = next;
		}
		return next;
	}
}

function statePathForScope(scope: HookTrustStorageScope, globalStatePath: string, projectStatePath: string): string {
	return scope === "global" ? globalStatePath : projectStatePath;
}

function serializeHookTrustState(state: HookTrustState): string {
	const sortedHooks: Record<string, HookTrustEntry> = {};
	for (const key of Object.keys(state.hooks).sort()) {
		const entry = state.hooks[key];
		if (entry !== undefined) {
			sortedHooks[key] = entry;
		}
	}
	return `${JSON.stringify({ version: 1, hooks: sortedHooks }, null, 2)}\n`;
}

function acquireHookStateLockSync(path: string): () => void {
	const stateDir = dirname(path);
	mkdirSync(stateDir, { recursive: true });
	const maxAttempts = 10;
	const delayMs = 20;
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return lockfile.lockSync(stateDir, { realpath: false, lockfilePath: `${path}.lock` });
		} catch (error) {
			const code = errorCode(error);
			if (code !== "ELOCKED" || attempt === maxAttempts) {
				throw error;
			}
			lastError = error;
			const start = Date.now();
			while (Date.now() - start < delayMs) {
				Date.now();
			}
		}
	}

	if (lastError instanceof Error) {
		throw lastError;
	}
	throw new Error("Failed to acquire hook state lock");
}

function errorCode(error: unknown): string | undefined {
	if (!isRecord(error)) {
		return undefined;
	}
	const code = error.code;
	return typeof code === "string" ? code : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withHookStateFileLock<T>(path: string, fn: (path: string) => T): T {
	const release = acquireHookStateLockSync(path);
	try {
		return fn(path);
	} finally {
		release();
	}
}
