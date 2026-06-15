export type AutoUpdateEnv = Record<string, string | undefined>;

export declare const DEFAULT_LOCK_STALE_MS: number;

export interface AcquiredLock {
	release(): Promise<void>;
}

export declare function resolveStatePath(env: AutoUpdateEnv): string;
export declare function resolveLogPath(env: AutoUpdateEnv): string;
export declare function resolveLockPath(env: AutoUpdateEnv, statePath: string): string;
export declare function acquireLock(lockPath: string, now: number, staleMs?: number): Promise<AcquiredLock | null>;
export declare function readState(statePath: string): Promise<Record<string, unknown>>;
export declare function writeState(statePath: string, state: unknown): Promise<void>;
export declare function appendUpdateLog(
	env: AutoUpdateEnv,
	now: number,
	event: string,
	details?: Record<string, unknown>,
): Promise<void>;
