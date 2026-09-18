export declare const HASHLINE_PENDING_CAPTURE_TTL_MS: number;
export type PendingCapture = {
    content: string;
    filePath: string;
    storedAt: number;
};
export declare function pruneStalePendingCaptures(now?: number): void;
export declare function setPendingCapture(sessionID: string, callID: string, capture: {
    content: string;
    filePath: string;
}): void;
export declare function takePendingCapture(sessionID: string, callID: string): PendingCapture | undefined;
export declare function stopPendingCaptureCleanup(): void;
