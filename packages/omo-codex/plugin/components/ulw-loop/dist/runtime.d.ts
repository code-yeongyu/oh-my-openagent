export interface UlwLoopErrorOptions {
    readonly cause?: unknown;
    readonly details?: Record<string, unknown>;
}
export declare class UlwLoopError extends Error {
    readonly code: string;
    readonly details?: Record<string, unknown>;
    constructor(message: string, code: string, opts?: UlwLoopErrorOptions);
}
export declare function iso(): string;
