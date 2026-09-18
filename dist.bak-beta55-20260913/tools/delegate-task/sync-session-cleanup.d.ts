import type { OpencodeClient } from "./types";
export declare function cancelSyncSessionDeletion(sessionID: string): void;
export declare function scheduleSyncSessionDeletion(client: OpencodeClient, sessionID: string, delayMs?: number): void;
