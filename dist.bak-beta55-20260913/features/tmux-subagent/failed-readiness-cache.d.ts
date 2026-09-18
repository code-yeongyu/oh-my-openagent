export interface FailedReadinessSessionSeed {
    sessionId: string;
    title: string;
}
export interface FailedReadinessSession extends FailedReadinessSessionSeed {
    rememberedAt: number;
}
export interface FailedReadinessCacheOptions {
    ttlMs: number;
    sweepIntervalMs: number;
    log: (message: string, data?: unknown) => void;
}
export declare class FailedReadinessCache {
    private readonly sessions;
    private sweepInterval?;
    private readonly ttlMs;
    private readonly sweepIntervalMs;
    private readonly log;
    constructor(options: FailedReadinessCacheOptions);
    remember(session: FailedReadinessSessionSeed): void;
    clear(sessionId: string): void;
    get(sessionId: string): FailedReadinessSession | undefined;
    clearAll(): void;
    private isExpired;
    private startSweep;
    private stopSweep;
    private sweepExpired;
}
