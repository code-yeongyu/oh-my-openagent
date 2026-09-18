import type { OpencodeClient } from "./types";
export declare function fetchSyncResult(client: OpencodeClient, sessionID: string, anchorMessageCount?: number, options?: {
    strictAbortRecovery?: boolean;
    deliverableTag?: string;
}): Promise<{
    ok: true;
    textContent: string;
} | {
    ok: false;
    error: string;
}>;
