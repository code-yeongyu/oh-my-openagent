import type { OpencodeClient } from "./types";
export declare function resolveSession(options: {
    client: OpencodeClient;
    sessionId?: string;
    directory: string;
    retryDelayMs?: number;
}): Promise<string>;
