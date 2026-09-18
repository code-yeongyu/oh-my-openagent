export declare const DEFAULT_BACKGROUND_OUTPUT_FETCH_TIMEOUT_MS = 5000;
export declare function _setBackgroundOutputFetchTimeoutMsForTesting(value: number | undefined): void;
export declare function getBackgroundOutputFetchTimeoutMs(): number;
export declare class BackgroundOutputFetchTimeoutError extends Error {
    constructor(timeoutMs: number);
}
export declare function withSdkCallTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T>;
